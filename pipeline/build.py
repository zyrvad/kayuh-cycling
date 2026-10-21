"""Build Kayuh's routing graph, map layers and POIs from data/raw/.

Usage: .venv/bin/python pipeline/build.py

Outputs
  web/public/data/graph.bin       routing graph (format: packages/router/src/graph.ts)
  web/public/data/pois.json       parking + amenities, snapped to graph nodes
  web/public/data/network.pmtiles tiers for the map (needs tippecanoe)
  data/build/network.geojson      same, as GeoJSON (input to tippecanoe)
  docs/DATA.md                    coverage report
"""
import json
import math
import shutil
import struct
import subprocess
import sys
import time
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import numpy as np
import osmium
import shapely
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).parent))
from classify import (FOOTPATH, QUIET_ROAD, ROAD, TIER_NAMES, Classified, classify,  # noqa: E402
                      upgrade)

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
BUILD = ROOT / "data" / "build"
OUT = ROOT / "web" / "public" / "data"
PBF = RAW / "msb-latest.osm.pbf"

MATCH_DISTANCE_M = 12      # gov geometry is "indicative": allow this much offset
MATCH_FRACTION = 0.6       # share of a way's sample points that must sit on gov geometry
SAMPLE_STEP_M = 8
SNAP_MAX_M = 80            # POIs further than this from any rideable edge are dropped
MIN_COMPONENT_EDGES = 25
N_SIGNAL, N_CROSSING = 1, 2

to_svy21 = Transformer.from_crs("EPSG:4326", "EPSG:3414", always_xy=True)


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- OSM passes

def pcn_relation_ways() -> dict:
    """Way id -> route name, for members of bicycle route relations that are park connectors."""
    members = {}
    fp = osmium.FileProcessor(str(PBF), osmium.osm.RELATION).with_filter(osmium.filter.TagFilter(("route", "bicycle")))
    for rel in fp:
        name = rel.tags.get("name", "")
        if rel.tags.get("ref") == "PCN" or "park connector" in name.lower() or rel.tags.get("network") in ("rcn", "lcn"):
            for m in rel.members:
                if m.type == "w":
                    members[m.ref] = name
    return members


POI_NODE_KINDS = {
    ("amenity", "bicycle_parking"): "parking",
    ("amenity", "drinking_water"): "water",
    ("amenity", "toilets"): "toilet",
    ("shop", "bicycle"): "bike_shop",
}


def poi_kind(tags):
    for (k, v), kind in POI_NODE_KINDS.items():
        if tags.get(k) == v:
            if kind == "parking" and tags.get("access") in ("private", "customers", "no"):
                return None
            return kind
    if tags.get("railway") == "station" and (tags.get("station") in ("subway", "light_rail")
                                             or "MRT" in tags.get("network", "") or "LRT" in tags.get("network", "")):
        return "mrt"
    return None


def read_osm(boundary, pcn_members):
    ways, node_flags, pois = [], {}, []
    bx0, by0, bx1, by1 = boundary.bounds
    shapely.prepare(boundary)

    def inside(lon, lat):
        return bx0 <= lon <= bx1 and by0 <= lat <= by1 and shapely.contains_xy(boundary, lon, lat)

    fp = osmium.FileProcessor(str(PBF)).with_locations().with_filter(
        osmium.filter.KeyFilter("highway", "amenity", "shop", "railway"))
    for obj in fp:
        if obj.is_node():
            t = obj.tags
            hw = t.get("highway")
            if hw == "traffic_signals" or t.get("crossing") == "traffic_signals":
                node_flags[obj.id] = node_flags.get(obj.id, 0) | N_SIGNAL
            elif hw == "crossing":
                node_flags[obj.id] = node_flags.get(obj.id, 0) | N_CROSSING
            kind = poi_kind(t)
            if kind and obj.location.valid() and inside(obj.location.lon, obj.location.lat):
                pois.append({"kind": kind, "lon": obj.location.lon, "lat": obj.location.lat,
                             "name": t.get("name", ""), "src": "osm",
                             "covered": t.get("covered") == "yes" or t.get("bicycle_parking") == "shed"})
        elif obj.is_way():
            t = obj.tags
            kind = poi_kind(t)
            if kind == "parking":
                try:
                    lon = sum(n.lon for n in obj.nodes) / len(obj.nodes)
                    lat = sum(n.lat for n in obj.nodes) / len(obj.nodes)
                except osmium.InvalidLocationError:
                    continue
                if inside(lon, lat):
                    pois.append({"kind": "parking", "lon": lon, "lat": lat, "name": t.get("name", ""),
                                 "src": "osm", "covered": t.get("covered") == "yes"})
                continue
            if "highway" not in t:
                continue
            tagd = {tag.k: tag.v for tag in t}
            if obj.id in pcn_members:
                tagd.setdefault("leisure", "park_connector")
            c = classify(tagd)
            if c is None:
                continue
            try:
                coords = [(n.lon, n.lat) for n in obj.nodes]
            except osmium.InvalidLocationError:
                continue
            if len(coords) < 2:
                continue
            mid = coords[len(coords) // 2]
            if not inside(*mid):
                continue
            ways.append({"id": obj.id, "c": c, "nodes": [n.ref for n in obj.nodes], "coords": coords,
                         "name": tagd.get("name") or pcn_members.get(obj.id, "")})
    return ways, node_flags, pois


# ---------------------------------------------------------------- conflation

def load_gov_lines(name, keep=lambda p: True):
    data = json.loads((RAW / "gov" / f"{name}.geojson").read_text())
    lines = []
    for f in data["features"]:
        g = f.get("geometry")
        if not g or not keep(f["properties"]):
            continue
        parts = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        for part in parts:
            xy = [to_svy21.transform(p[0], p[1]) for p in part]
            if len(xy) >= 2:
                lines.append(shapely.LineString(xy))
    return lines


def project_line(coords):
    xs, ys = to_svy21.transform([c[0] for c in coords], [c[1] for c in coords])
    return shapely.LineString(list(zip(xs, ys)))


def sample_points(lines, step):
    """Points every `step` metres along each line; returns (points, owner index)."""
    pts, owner = [], []
    for i, line in enumerate(lines):
        n = max(2, int(line.length / step) + 1)
        d = np.linspace(0, line.length, n)
        pts.append(shapely.line_interpolate_point(line, d))
        owner.append(np.full(n, i))
    return np.concatenate(pts), np.concatenate(owner)


def match_fraction(lines, targets, distance):
    """For each line, the fraction of its sample points within `distance` of any target line."""
    if not targets or not lines:
        return np.zeros(len(lines))
    tree = shapely.STRtree(targets)
    pts, owner = sample_points(lines, SAMPLE_STEP_M)
    hit_pts = np.unique(tree.query(pts, predicate="dwithin", distance=distance)[0])
    hits = np.bincount(owner[hit_pts], minlength=len(lines))
    totals = np.bincount(owner, minlength=len(lines))
    return hits / np.maximum(totals, 1)


# ---------------------------------------------------------------- graph

def split_ways(ways):
    """Split ways at junctions into edges between graph nodes."""
    refs = Counter()
    for w in ways:
        refs.update(w["nodes"])
        refs[w["nodes"][0]] += 1
        refs[w["nodes"][-1]] += 1
    edges = []
    for wi, w in enumerate(ways):
        start = 0
        for i in range(1, len(w["nodes"])):
            if refs[w["nodes"][i]] > 1 or i == len(w["nodes"]) - 1:
                if w["nodes"][start] != w["nodes"][i] or i - start > 1:
                    edges.append((wi, start, i))
                start = i
    return edges


def components(n_nodes, a, b):
    parent = np.arange(n_nodes)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for u, v in zip(a, b):
        ru, rv = find(u), find(v)
        if ru != rv:
            parent[ru] = rv
    return np.array([find(i) for i in range(n_nodes)])


def simplify(coords_xy, coords_ll, tol=1.5):
    """Douglas-Peucker in projected metres; returns the kept lon/lat points (endpoints included)."""
    if len(coords_xy) <= 2:
        return coords_ll
    keep = [False] * len(coords_xy)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords_xy) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = coords_xy[i], coords_xy[j]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1e-9
        best, best_k = 0.0, -1
        for k in range(i + 1, j):
            x0, y0 = coords_xy[k]
            d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
            if d > best:
                best, best_k = d, k
        if best > tol:
            keep[best_k] = True
            stack += [(i, best_k), (best_k, j)]
    return [p for p, k in zip(coords_ll, keep) if k]


# ---------------------------------------------------------------- main

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)
    boundary = shapely.from_wkt((RAW / "sg_boundary.wkt").read_text())

    log("reading PCN route relations")
    pcn_members = pcn_relation_ways()
    log(f"  {len(pcn_members)} member ways")

    log("reading ways, nodes and POIs")
    ways, node_flags, pois = read_osm(boundary, pcn_members)
    log(f"  {len(ways)} rideable ways, {len(pois)} OSM POIs")

    log("conflating with government geometry")
    pcn_gov = load_gov_lines("park_connector_loop") + load_gov_lines("pcn_mp25")
    cyc_gov = load_gov_lines("cycling_path_network") + load_gov_lines(
        "cycling_mp25", keep=lambda p: (p.get("PRP_STATUS") or "").upper() not in ("PLANNED", "PROPOSED", "FUTURE"))
    candidates = [i for i, w in enumerate(ways)
                  if w["c"].tier not in (QUIET_ROAD, ROAD)]
    cand_lines = [project_line(ways[i]["coords"]) for i in candidates]
    pcn_frac = match_fraction(cand_lines, pcn_gov, MATCH_DISTANCE_M)
    cyc_frac = match_fraction(cand_lines, cyc_gov, MATCH_DISTANCE_M)
    upgraded = Counter()
    for k, i in enumerate(candidates):
        before = ways[i]["c"].tier
        ways[i]["c"] = upgrade(ways[i]["c"], pcn_frac[k] >= MATCH_FRACTION, cyc_frac[k] >= MATCH_FRACTION)
        if ways[i]["c"].tier != before:
            upgraded[(TIER_NAMES[before], TIER_NAMES[ways[i]["c"].tier])] += 1
    log(f"  upgrades: {dict(upgraded)}")

    log("splitting into edges")
    raw_edges = split_ways(ways)
    osm_node_id = {}
    node_ll = []

    def node_index(osm_id, ll):
        if osm_id not in osm_node_id:
            osm_node_id[osm_id] = len(node_ll)
            node_ll.append(ll)
        return osm_node_id[osm_id]

    e_from, e_to = [], []
    for wi, s, e in raw_edges:
        w = ways[wi]
        e_from.append(node_index(w["nodes"][s], w["coords"][s]))
        e_to.append(node_index(w["nodes"][e], w["coords"][e]))
    comp = components(len(node_ll), e_from, e_to)
    comp_size = Counter(comp[np.array(e_from)])
    keep_edge = [comp_size[comp[a]] >= MIN_COMPONENT_EDGES for a in e_from]
    log(f"  {len(raw_edges)} edges, dropping {keep_edge.count(False)} in tiny islands")

    # Re-index nodes using only kept edges
    final_nodes, remap = [], {}
    inv_osm = {v: k for k, v in osm_node_id.items()}

    def keep_node(i):
        if i not in remap:
            remap[i] = len(final_nodes)
            final_nodes.append(i)
        return remap[i]

    strings, string_index = [], {}

    def sid(s):
        if s not in string_index:
            string_index[s] = len(strings)
            strings.append(s)
        return string_index[s]

    E = {"from": [], "to": [], "len": [], "tier": [], "flags": [], "name": [], "reason": [], "geom": [0]}
    coords_out = []
    tier_len = Counter()
    features = []
    for (wi, s, e), a, b, keep in zip(raw_edges, e_from, e_to, keep_edge):
        if not keep:
            continue
        w = ways[wi]
        c: Classified = w["c"]
        ll = w["coords"][s:e + 1]
        xs, ys = to_svy21.transform([p[0] for p in ll], [p[1] for p in ll])
        xy = list(zip(xs, ys))
        length = sum(math.dist(xy[k], xy[k + 1]) for k in range(len(xy) - 1))
        if length < 0.05:
            continue
        simp = simplify(xy, ll)
        E["from"].append(keep_node(a))
        E["to"].append(keep_node(b))
        E["len"].append(length)
        E["tier"].append(c.tier)
        E["flags"].append(c.flags)
        E["name"].append(sid(w["name"]) if w["name"] else 0xFFFFFFFF)
        E["reason"].append(sid(c.reason))
        coords_out.extend(simp[1:-1])
        E["geom"].append(len(coords_out))
        tier_len[c.tier] += length
        if c.tier < QUIET_ROAD:  # the basemap already draws roads
            feature = {"type": "Feature",
                       "properties": {"t": c.tier, "n": w["name"], "r": c.reason,
                                      "lit": int(bool(c.flags & 4)), "sh": int(bool(c.flags & 8))},
                       "geometry": {"type": "LineString",
                                    "coordinates": [[round(x, 6), round(y, 6)] for x, y in simp]}}
            if c.tier == FOOTPATH:
                feature["tippecanoe"] = {"minzoom": 13}
            features.append(feature)
    n_nodes = len(final_nodes)
    log(f"  graph: {n_nodes} nodes, {len(E['from'])} edges, {len(coords_out)} shape points")

    # ---------------------------------------------------------------- POIs
    log("snapping POIs")
    gov = RAW / "gov"
    for f in json.loads((gov / "bicycle_rack.geojson").read_text())["features"]:
        lon, lat = f["geometry"]["coordinates"][:2]
        desc = f["properties"].get("Description", "")
        pois.append({"kind": "parking", "lon": lon, "lat": lat, "name": "LTA bicycle rack", "src": "lta",
                     "covered": "SHLTR_IND</th> <td>Yes" in desc})
    for f in json.loads((gov / "hawker_centres.geojson").read_text())["features"]:
        p = f["properties"]
        if (p.get("STATUS") or "Existing").lower().startswith("existing"):
            lon, lat = f["geometry"]["coordinates"][:2]
            pois.append({"kind": "hawker", "lon": lon, "lat": lat, "name": p.get("NAME", ""), "src": "nea"})

    # Snap targets: nodes that touch at least one non-road edge (so parking joins the nice network)
    nice_nodes = sorted({n for n, t in zip(E["from"], E["tier"]) if t != ROAD} |
                        {n for n, t in zip(E["to"], E["tier"]) if t != ROAD})
    nll = [node_ll[final_nodes[i]] for i in nice_nodes]
    nx, ny = to_svy21.transform([p[0] for p in nll], [p[1] for p in nll])
    tree = shapely.STRtree(shapely.points(nx, ny))
    px, py = to_svy21.transform([p["lon"] for p in pois], [p["lat"] for p in pois])
    idx, dist = tree.query_nearest(shapely.points(px, py), max_distance=SNAP_MAX_M, return_distance=True)
    snapped = {}
    for (pi, ti), d in zip(idx.T, dist):
        if pi not in snapped:
            snapped[pi] = (nice_nodes[ti], d)

    # Dedupe parking within 10 m, preferring official LTA racks
    out_pois, seen = [], []
    order = sorted(range(len(pois)), key=lambda i: (pois[i]["kind"], pois[i]["src"] != "lta"))
    seen_tree_pts = defaultdict(list)
    for i in order:
        if i not in snapped:
            continue
        p = pois[i]
        x, y = px[i], py[i]
        cell = (p["kind"], int(x // 10), int(y // 10))
        near = [seen_tree_pts[(p["kind"], cell[1] + dx, cell[2] + dy)] for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
        if any(math.dist((x, y), q) < 10 for bucket in near for q in bucket):
            continue
        seen_tree_pts[cell].append((x, y))
        node, d = snapped[i]
        out_pois.append({"k": p["kind"], "lon": round(p["lon"], 6), "lat": round(p["lat"], 6),
                         "n": p.get("name", ""), "s": p["src"], "c": int(p.get("covered", False)),
                         "node": node, "walk": round(float(d))})
    kinds = Counter(p["k"] for p in out_pois)
    log(f"  POIs kept: {dict(kinds)}")

    # ---------------------------------------------------------------- coverage report
    log("coverage report")
    nice_lines = [project_line(f["geometry"]["coordinates"]) for f in features]
    pcn_cov = match_fraction(pcn_gov, nice_lines, MATCH_DISTANCE_M)
    cyc_cov = match_fraction(cyc_gov, nice_lines, MATCH_DISTANCE_M)
    pcn_len = sum(l.length for l in pcn_gov)
    cyc_len = sum(l.length for l in cyc_gov)
    report = {
        "built": date.today().isoformat(),
        "nodes": n_nodes, "edges": len(E["from"]),
        "km_by_tier": {TIER_NAMES[t]: round(v / 1000, 1) for t, v in sorted(tier_len.items())},
        "upgrades": {f"{a}->{b}": n for (a, b), n in upgraded.items()},
        "gov_pcn_km": round(pcn_len / 1000, 1),
        "gov_pcn_covered_pct": round(100 * float(np.dot(pcn_cov, [l.length for l in pcn_gov])) / pcn_len, 1),
        "gov_cycling_km": round(cyc_len / 1000, 1),
        "gov_cycling_covered_pct": round(100 * float(np.dot(cyc_cov, [l.length for l in cyc_gov])) / cyc_len, 1),
        "pois": dict(kinds),
        "parking_by_source": dict(Counter(p["s"] for p in out_pois if p["k"] == "parking")),
    }
    (BUILD / "report.json").write_text(json.dumps(report, indent=2))
    log(json.dumps(report))

    # ---------------------------------------------------------------- write graph.bin
    log("writing outputs")
    nodes_lon = np.array([round(node_ll[i][0] * 1e6) for i in final_nodes], dtype="<i4")
    nodes_lat = np.array([round(node_ll[i][1] * 1e6) for i in final_nodes], dtype="<i4")
    nflags = np.array([node_flags.get(inv_osm[i], 0) for i in final_nodes], dtype="u1")
    str_bytes = json.dumps(strings, ensure_ascii=False).encode()
    coords_arr = np.array([[round(x * 1e6), round(y * 1e6)] for x, y in coords_out], dtype="<i4").reshape(-1)

    def pad4(b: bytes) -> bytes:
        return b + b"\0" * (-len(b) % 4)

    sections = [
        nodes_lon.tobytes(), nodes_lat.tobytes(), pad4(nflags.tobytes()),
        np.array(E["from"], "<u4").tobytes(), np.array(E["to"], "<u4").tobytes(),
        np.array(E["len"], "<f4").tobytes(),
        pad4(np.array(E["tier"], "u1").tobytes()), pad4(np.array(E["flags"], "u1").tobytes()),
        np.array(E["name"], "<u4").tobytes(), np.array(E["reason"], "<u4").tobytes(),
        np.array(E["geom"], "<u4").tobytes(), coords_arr.tobytes(), pad4(str_bytes),
    ]
    header = struct.pack("<4sIIIII", b"KYH1", 1, n_nodes, len(E["from"]), len(coords_out), len(str_bytes))
    (OUT / "graph.bin").write_bytes(header + b"".join(sections))
    (OUT / "pois.json").write_text(json.dumps({"built": report["built"], "pois": out_pois}, separators=(",", ":")))
    (BUILD / "network.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    log(f"  graph.bin {(OUT / 'graph.bin').stat().st_size / 1e6:.1f} MB")

    # Plain {z}/{x}/{y}.pbf tiles: work on any static host (PMTiles needs HTTP range requests).
    tiles = OUT / "tiles"
    if shutil.which("tippecanoe"):
        shutil.rmtree(tiles, ignore_errors=True)
        subprocess.run(["tippecanoe", "-e", str(tiles), "--force", "-l", "network", "--no-tile-compression",
                        "-Z", "10", "-z", "15", "--drop-densest-as-needed", "--no-tile-size-limit",
                        "-q", str(BUILD / "network.geojson")], check=True)
        n = sum(1 for _ in tiles.rglob("*.pbf"))
        size = sum(p.stat().st_size for p in tiles.rglob("*.pbf"))
        log(f"  tiles: {n} files, {size / 1e6:.1f} MB")
    else:
        log("  tippecanoe not found: skipped map tiles")

    write_data_md(report)
    log("done")


def write_data_md(r):
    km = r["km_by_tier"]
    lines = [
        "# Data coverage", "",
        f"_Generated by `pipeline/build.py` on {r['built']}. Rebuild to refresh._", "",
        "## Rideable network (km)", "",
        "| Tier | km |", "|---|---|",
        *[f"| {t} | {v} |" for t, v in km.items()], "",
        f"Graph: {r['nodes']:,} nodes, {r['edges']:,} edges.", "",
        "## Government geometry matched to OSM paths", "",
        f"- NParks + URA park connectors: {r['gov_pcn_km']} km, **{r['gov_pcn_covered_pct']}%** within "
        f"{MATCH_DISTANCE_M} m of a rideable OSM path.",
        f"- LTA + URA cycling paths: {r['gov_cycling_km']} km, **{r['gov_cycling_covered_pct']}%** matched.",
        "", "Tier upgrades from conflation:", "",
        *[f"- {k}: {v} ways" for k, v in r["upgrades"].items()], "",
        "## POIs (snapped within "
        f"{SNAP_MAX_M} m of the rideable network)", "",
        *[f"- {k}: {v}" for k, v in r["pois"].items()],
        f"- parking by source: {r['parking_by_source']}", "",
    ]
    (ROOT / "docs" / "DATA.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
