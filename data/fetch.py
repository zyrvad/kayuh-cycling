"""Download Kayuh's raw inputs into data/raw/.

Usage: .venv/bin/python data/fetch.py [--skip-osm]

- OpenStreetMap: Geofabrik malaysia-singapore-brunei extract (cut to SG later by the pipeline).
- data.gov.sg GeoJSON datasets, via the poll-download endpoint.
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


def fetch_osm() -> None:
    out = RAW / "msb-latest.osm.pbf"
    with session.get(OSM_URL, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(out, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    print(f"osm: {out.stat().st_size / 1e6:.0f} MB")


if __name__ == "__main__":
    fetch_gov()
    if "--skip-osm" not in sys.argv:
        fetch_osm()
