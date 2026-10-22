# CLAUDE.md — Kayuh

## Project

**Kayuh** (Malay: "to pedal") is a Singapore-only cycling route planner for me and my friends. It optimises for **path quality**: Park
Connectors (PCN), cycling paths and wide shared paths first, roads only as a last resort.
It supports waypoint routing (start → any stops → end), loop suggestions and GPX export.

Read [KICKOFF.md](KICKOFF.md) for the why and the decisions taken, and [PLAN.md](PLAN.md) for
the phased roadmap, and [docs/FEATURES.md](docs/FEATURES.md) for the full feature list. **Check PLAN.md for the current phase before starting work.**

Standalone side project. Not related to Love Letter Box. No GSD workflow: work directly in the
repo.

## Constraints

- **Cost:** $0/month target. Free tiers only. No always-on servers for the MVP.
- **Platform:** mobile-first web app (PWA) on Cloudflare Pages. No native app: a free Apple
  account makes native builds expire every 7 days.
- **Scope:** Singapore only. The whole graph is meant to fit in the browser.
- **Licensing:** OSM data is ODbL, and gov data is under the Singapore Open Data Licence. Show
  attribution on the map ("© OpenStreetMap contributors", data.gov.sg / NParks / LTA, OneMap
  when its tiles or search are used).

## Stack

| Part | Choice |
|---|---|
| Data pipeline | Python 3.12 venv (`.venv`), `pyosmium` + `shapely` + `pyproj` for conflation, `tippecanoe` for tiles. Run offline on the Mac. |
| Graph build output | `web/public/data/graph.bin` (format in `packages/router/src/graph.ts`), `pois.json`, static vector tiles `tiles/{z}/{x}/{y}.pbf` (not PMTiles: needs HTTP range support) |
| Router | `packages/router`: plain TypeScript, no DOM/browser APIs, so a future Expo app can reuse it |
| Web app | Vite + Preact + `@preact/signals`, MapLibre GL JS, router in a Web Worker |
| Basemap | OpenFreeMap positron (free, no key) |
| Place search | OneMap search API, proxied by the Worker (optional `ONEMAP_TOKEN` secret) |
| Hosting | One Cloudflare Worker with Static Assets: serves `web/dist` and `/api/*` |
| Cloud API | Cloudflare Worker (Hono) + D1 + R2: accounts (Google + email magic link), crews, routes, group rides, ride history, feedback, OneMap/NEA proxies. Not Supabase: its free tier pauses after a week idle. |

## Repo layout

```
data/fetch.py        downloads raw inputs (data/raw/ is git-ignored)
pipeline/            classify.py (tags → tier, tested) and build.py (graph, POIs, tiles, docs/DATA.md)
packages/router/     graph loader, A*, profiles, legs, loops, GPX; test/unit + test/golden
web/                 Preact app; src/components/* are the Calm screens
worker/              Hono API + D1 migrations; test/ uses a node:sqlite D1 shim
```

Running and testing: see README.md. The preview config is named `kayuh` (wrangler dev on :8790; lovebox uses 8788).

## Domain rules (keep these true in code)

- **Tiers:** `pcn` < `cycleway` < `shared` < `footpath` < `quiet_road` < `road` in cost.
  Exclude expressways, `bicycle=no`, and stairs without a ramp. Default multipliers are in
  PLAN.md Phase 1. They are tunable, so never hard-code them in more than one place.
- **SG law:** bicycles are allowed on footpaths (10 km/h), shared paths and cycling paths
  (25 km/h), and banned on expressways. Time estimates use per-tier speeds that respect these
  limits.
- **OSM PCN signals:** `leisure=park_connector`, membership of the PCN route relation
  (`route=bicycle`, `ref=PCN`), and `bicycle=designated`. Gov geometry is "indicative" or
  "symbolic", so snap it onto OSM ways (buffer ~10 m + direction/overlap check). Never route
  on the gov lines directly.
- **Rental bikes:** users ride HelloRide or Anywheel bikes on month passes where the first 30 min
  of each ride is free. Split routes into legs under the user's cap (default 30 min). Every leg end,
  stop and route end snaps to **legal bike parking** (LTA designated parking; a $5 fine otherwise).
  A group ride uses the strictest cap among its riders.
- **Watch export:** GPX 1.1 with simplified geometry, plus named waypoints for parking and leg
  breaks. It must import into Huawei Health (GT 4) and Zepp (Amazfit).
- **Privacy:** rides are private by default. Sharing with a crew is opt-in per ride, and the
  first and last ~200 m are always trimmed. Store routes and feedback as geometry, never as graph
  edge IDs, because IDs change on every monthly rebuild.
- Every edge keeps a record of **why** it got its tier (which tags or dataset), so the map can
  explain it when tapped.

## Data sources

- Geofabrik `malaysia-singapore-brunei-latest.osm.pbf`, cut to the SG boundary.
- data.gov.sg: NParks **Park Connector Loop** (GeoJSON, `PCN_LOOP` names), LTA **Cycling Path
  Network** (GeoJSON/KML), URA park connector layers (check whether superseded). Download with
  the poll-download endpoint + dataset ID.
- OneMap API: search (postal codes, buildings); routing with cycle mode is used as a comparison
  baseline only. A token is needed for routing. Keep it in `.env`, never commit it.

## Working conventions

- Verify on the **deployed** site, not only `vite dev`. Lesson from Dispatch: local passes and
  production fails.
- Any change to the pipeline or router must keep the golden routes passing (`tests/golden`).
- Commit build artefacts that the web app needs (graph, tiles). Don't commit raw downloads.
- Keep it simple: Jaden prefers informed recommendations and the fast/simple path over option
  lists and extra infrastructure.
