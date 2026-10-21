# Plan — Kayuh

Each phase ends with something usable on a ride. Data comes first because it's the bottleneck.
Full feature list: [docs/FEATURES.md](docs/FEATURES.md). Decisions: [KICKOFF.md](KICKOFF.md).

| # | Phase | You can use it to… |
|---|---|---|
| 0 | Data spike | Decide whether the data is good enough |
| 1 | Network map + parking layer, PWA shell | See where to ride and where you can park |
| 2 | Routing MVP | **Plan real rides** |
| 3 | Accounts, crews, saved and shared routes | Send routes to friends |
| 4 | Suggestions | Get ideas, not just routes |
| 5 | Group rides, history, follow mode | Ride together, track progress |
| 6 | Conditions, feedback, polish (native app if needed) | Ride-day confidence |

---

## Status (21 Oct 2026)

Phases 0–2 are built and running locally, plus a first slice of 3 (device-based save and share,
no sign-in yet) and of 5 (ride mode with leg timer, private ride history). Not deployed yet.
Golden routes pass. The open data gap is parking density (see docs/DATA.md): add the LTA DataMall
bicycle-parking API (needs a free AccountKey).

## Phase 0: Data spike

- `data/fetch.py`: Geofabrik extract cut to SG with `osmium`, and data.gov.sg (NParks PCN Loop,
  LTA Cycling Path Network, URA connectors). Also **LTA DataMall bicycle parking**, MRT stations,
  and hawker centres. Raw files go into `data/raw/` (git-ignored).
- Coverage report: km by OSM tag; % of NParks and LTA geometry matched to an OSM way within ~10 m;
  where the gaps are.
- **Parking check:** does DataMall bicycle parking match the QR-coded spots that shared bikes must
  use? Is parking dense enough along the PCNs for a leg end every ~7 km?
- Overlay map of all layers. Eyeball East Coast, Punggol, the Rail Corridor and Jurong Lake.
- Baseline: OneMap routing with cycle mode for 2–3 trips.
- **Watch test:** hand-made GPX into Huawei Health (GT 4) and Zepp (Amazfit). Record point limits,
  how waypoints display, and turn prompts vs breadcrumb only.

**Exit:** `docs/DATA.md` written with numbers; conflation approach chosen; own router confirmed (or
BRouter/GraphHopper fallback).

## Phase 1: Network map + parking

- `pipeline/`: classified edges with tiers (pcn 1.0 · cycleway 1.1 · shared 1.3 · footpath 2.0 ·
  quiet_road 2.5 · road 6.0 · excluded). Each edge keeps length, surface, lit, shelter, crossings,
  and why it got its tier. Parking spots are attached to their nearest edge.
- Outputs `network.pmtiles`, `pois.json` and a data-quality report. A GitHub Action rebuilds monthly.
- Web app: Vite + TS + MapLibre, PWA, light and dark themes, a colour-coded network with a legend,
  layer toggles, and tap-to-explain. Deployed to Cloudflare Pages.

**Done when:** I trust the colours and the parking dots in areas I know, on my phone.

## Phase 2: Routing MVP

- Compact graph (`graph.bin`, < 5 MB gzipped). The router is a plain TS package in a Web Worker
  (reusable by a future Expo app).
- A to B and Freeform modes, OneMap search, preference sliders, and alternatives
  (nicest / balanced / direct).
- **Parking-aware endpoints** and **pass-aware legs** (default 30 min, set by the operator in
  Settings). Leg ends prefer parking near water, toilets, food or shade.
- Route breakdown, MRT bail-out points, deep link to the HelloRide or Anywheel app.
- **Send to watch** (GPX with waypoints). Saved routes in local storage.

**Done when:** golden routes pass and I plan and ride a real trip with it.

## Phase 3: Accounts, crews, sharing

- Worker (Hono) + D1 + R2. Google sign-in + email magic link.
- Tables: `users`, `sessions`, `crews`, `crew_members`, `invites`, `routes`.
- Saved routes sync. Share links work without an account. WhatsApp/OG preview image of the route.
- OneMap token proxy.

## Phase 4: Suggestions

- Loop generator (target distance or time). Exploration mode (chain loops and food stops).
  Automatic stop ordering.
- PCN loop and classic-ride templates. "Surprise me". Import a GPX and re-route it onto nicer paths.

## Phase 5: Group rides, history, follow mode

- `group_rides`, `rsvps`: date and time, route, meet in the middle, legal meeting point, strictest
  pass cap, `.ics` export, web push reminders.
- `rides` (GPX in R2): private by default, opt-in crew sharing, start and end trimmed. Heatmap,
  % PCN explored, loop badges.
- Follow mode: position, voice prompts, off-route re-routing, leg timer, MRT bail-out.

## Phase 6: Conditions, feedback, polish

- NEA rain, WBGT, lightning and PSI along the route; sunset and unlit warnings; shelter preference
  when raining.
- Segment feedback (great / avoid / temporarily closed with expiry), applied as personal overrides.
- Native Expo app only if background navigation or recording turns out to be needed.

---

## Golden test routes (proposed; amend freely)

| Route | Expectation |
|---|---|
| East Coast Park → Changi Village | ≥ 85 % pcn/cycleway, ≤ 3 road crossings, legal parking at the end |
| Punggol Waterway loop | ≥ 90 % pcn, a loop with little doubling back |
| Rail Corridor, Buona Vista → Bukit Timah | Stays on the corridor, not on Bukit Timah Rd |
| Kallang → Marina Barrage → Gardens by the Bay | No arterial road segments |
| Jurong Lake Gardens loop | ≥ 90 % pcn/shared |
| Tampines → Bedok Reservoir (errand) | Uses Tampines cycling paths; < 10 % road |

Every leg must be under 30 min at 15 km/h and end at legal parking.

## Testing approach

- The golden routes above run on every pipeline or router change.
- Unit tests: tag-to-tier classification, conflation matching, the router on tiny graphs, leg
  splitting, GPX output.
- Visual check on the **deployed** site.

## Cost target

$0/month. Everything is on free tiers (Pages, Workers, D1, R2, OneMap, data.gov.sg, LTA DataMall).
