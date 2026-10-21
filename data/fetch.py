"""Download Kayuh's raw inputs into data/raw/.

Usage: .venv/bin/python data/fetch.py [--skip-osm] [--only-datamall]
(LTA_DATAMALL_KEY is read from the environment or the git-ignored .env file.)

- OpenStreetMap: Geofabrik malaysia-singapore-brunei extract (cut to SG later by the pipeline).
- data.gov.sg GeoJSON datasets, via the poll-download endpoint.
- LTA DataMall bicycle parking (racks + yellow boxes), when LTA_DATAMALL_KEY is set.
  Register for a free AccountKey at https://datamall.lta.gov.sg.
"""
import json
import sys
import time
from pathlib import Path

import requests

RAW = Path(__file__).resolve().parent / "raw"
GOV = RAW / "gov"
OSM_URL = "https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf"

# name -> data.gov.sg dataset id
DATASETS = {
    "park_connector_loop": "d_a69ef89737379f231d2ae93fd1c5707f",   # NParks, has PCN_LOOP names
    "pcn_mp25": "d_cebde179d5cd6b85be36d618c8fe3b85",              # URA Master Plan 2025 park connector lines
    "cycling_path_network": "d_8f468b25193f64be8a16fa7d8f60f553",  # LTA + Town Councils
    "cycling_mp25": "d_8fd4e04e7058ee19521d123caf28a855",          # URA Master Plan 2025 cycling network
    "bicycle_rack": "d_937424cca6d1617288a82a7aeb89f76d",          # LTA bicycle racks (legal parking)
    "hawker_centres": "d_4a086da0a5553be1d89383cd90d07ecd",
}

session = requests.Session()
session.headers["User-Agent"] = "kayuh-pipeline/0.1 (personal project)"


def get(url: str, **kw) -> requests.Response:
    """GET with backoff: data.gov.sg rate-limits anonymous callers (HTTP 429)."""
    for attempt in range(8):
        r = session.get(url, **kw)
        if r.status_code != 429:
            r.raise_for_status()
            return r
        time.sleep(10 * (attempt + 1))
    r.raise_for_status()
    return r


def poll_download(dataset_id: str) -> str:
    url = f"https://api-open.data.gov.sg/v1/public/api/datasets/{dataset_id}/poll-download"
    for _ in range(10):
        r = get(url, timeout=60)
        body = r.json()
        link = (body.get("data") or {}).get("url")
        if link:
            return link
        time.sleep(3)
    raise RuntimeError(f"no download url for {dataset_id}: {body}")


def fetch_gov() -> None:
    GOV.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, dataset_id in DATASETS.items():
        out = GOV / f"{name}.geojson"
        if out.exists() and "--force" not in sys.argv:
            data = json.loads(out.read_text())
        else:
            data = get(poll_download(dataset_id), timeout=300).json()
            out.write_text(json.dumps(data))
            time.sleep(5)
        manifest[name] = {"id": dataset_id, "features": len(data.get("features", []))}
        print(f"{name}: {manifest[name]['features']} features")
    (GOV / "manifest.json").write_text(json.dumps(manifest, indent=2))


DATAMALL_URL = "https://datamall2.mytransport.sg/ltaodataservice/BicycleParkingv2"
DATAMALL_RADIUS_KM = 0.8
DATAMALL_STEP_KM = 1.0  # grid spacing; circles of 0.8 km overlap enough to cover every square
DATAMALL_PAGE = 500


def parse_datamall(value: list) -> list:
    """DataMall BicycleParkingv2 rows -> our parking records (racks and yellow boxes)."""
    out = []
    for v in value:
        try:
            lat, lon = float(v["Latitude"]), float(v["Longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        out.append({
            "lat": lat, "lon": lon,
            "name": (v.get("Description") or "").strip(),
            "type": (v.get("RackType") or "").strip(),
            "count": int(v.get("RackCount") or 0),
            "sheltered": (v.get("ShelterIndicator") or "").upper().startswith("Y"),
        })
    return out


def fetch_datamall_parking(key: str) -> None:
    """Every public bike rack and yellow box: the places shared bikes may legally be parked.

    The API answers "parking within X km of a point", so sweep a grid over Singapore's land.
    """
    import shapely
    boundary = shapely.from_wkt((RAW / "sg_boundary.wkt").read_text())
    minx, miny, maxx, maxy = boundary.bounds
    dlat = DATAMALL_STEP_KM / 111.32
    dlon = dlat / 0.9997  # cos(1.35 deg)
    seen, rows = set(), []
    calls = 0

    def query(lat: float, lon: float, radius_km: float, depth: int = 0) -> None:
        nonlocal calls
        for attempt in range(5):
            r = session.get(DATAMALL_URL, params={"Lat": f"{lat:.6f}", "Long": f"{lon:.6f}", "Dist": radius_km},
                            headers={"AccountKey": key, "accept": "application/json"}, timeout=30)
            if r.status_code != 429:
                break
            time.sleep(5 * (attempt + 1))
        r.raise_for_status()
        calls += 1
        value = r.json().get("value", [])
        # DataMall pages long answers at 500 rows: split a crowded circle into four smaller ones.
        if len(value) >= DATAMALL_PAGE and depth < 4:
            off = radius_km / 2 / 111.32
            for dy, dx in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                query(lat + dy * off, lon + dx * off, radius_km * 0.6, depth + 1)
            return
        for p in parse_datamall(value):
            k = (round(p["lat"], 5), round(p["lon"], 5))
            if k not in seen:
                seen.add(k)
                rows.append(p)
        time.sleep(0.05)

    lat = miny
    while lat <= maxy:
        lon = minx
        while lon <= maxx:
            if shapely.contains_xy(boundary, lon, lat):
                query(lat, lon, DATAMALL_RADIUS_KM)
            lon += dlon
        lat += dlat
        print(f"  datamall: {lat:.3f}/{maxy:.3f}, {len(rows)} so far", flush=True)
    GOV.mkdir(parents=True, exist_ok=True)
    (GOV / "datamall_bicycle_parking.json").write_text(json.dumps(rows))
    print(f"datamall: {len(rows)} parking places from {calls} calls")


def fetch_osm() -> None:
    out = RAW / "msb-latest.osm.pbf"
    with session.get(OSM_URL, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(out, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    print(f"osm: {out.stat().st_size / 1e6:.0f} MB")


def load_env() -> None:
    """Read KEY=value lines from the repo's git-ignored .env into os.environ."""
    import os
    env = RAW.parent.parent / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


if __name__ == "__main__":
    import os
    load_env()
    if "--only-datamall" not in sys.argv:
        fetch_gov()
    key = os.environ.get("LTA_DATAMALL_KEY")
    if key:
        fetch_datamall_parking(key)
    else:
        print("datamall: skipped (set LTA_DATAMALL_KEY to fetch every rack and yellow box)")
    if "--skip-osm" not in sys.argv and "--only-datamall" not in sys.argv:
        fetch_osm()
