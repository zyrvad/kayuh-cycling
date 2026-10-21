# Kayuh

Cycling routes in Singapore that stay on park connectors, avoid roads, and end at legal bike
parking. They're split into legs that each fit a HelloRide or Anywheel free 30-minute ride.

See [KICKOFF.md](KICKOFF.md) for the why, [PLAN.md](PLAN.md) for phases,
[docs/FEATURES.md](docs/FEATURES.md) for features, and [docs/DATA.md](docs/DATA.md) for data coverage.

## How it fits together

```
data/fetch.py        OSM (Geofabrik) + data.gov.sg (NParks PCN, LTA/URA cycling paths, LTA racks, hawkers)
pipeline/build.py    classify → conflate → graph → web/public/data/{graph.bin, pois.json, tiles/}
packages/router      TypeScript router: A*, profiles, parking-aware 30-min legs, loops, GPX (runs in the browser)
web/                 Preact + MapLibre PWA (Calm design); the router runs in a Web Worker
worker/              Cloudflare Worker (Hono + D1): serves web/dist and /api (search, conditions, routes, rides, feedback)
```

## Run it locally

```bash
npm install
```

```bash
.venv/bin/python data/fetch.py
```

```bash
npm run pipeline
```

```bash
npm run dev
```

Then open http://127.0.0.1:8787. Add `?sim=20` to play ride mode back at 20× speed without GPS.

The first setup needs a Python 3.12 venv with the pipeline's dependencies:

```bash
python3.12 -m venv .venv && .venv/bin/pip install osmium shapely pyproj requests pytest
```

The pipeline also needs `tippecanoe` (`brew install tippecanoe`) for the map tiles.

## Tests

```bash
npm test
```

```bash
npm run golden
```

```bash
npm test -w worker
```

- `npm test`: router unit tests and pipeline classifier tests.
- `npm run golden`: the six golden routes plus a loop, on the real Singapore graph.
- `npm test -w worker`: API tests against the real SQL migrations.

## Deploy (not done yet)

1. Create the database with `npx wrangler d1 create kayuh` (in `worker/`).
2. Put the id it prints into `worker/wrangler.toml`.
3. Run `npm run deploy`.
