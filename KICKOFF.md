# Kickoff — Kayuh

_Started 21 Oct 2026. Kayuh is Malay for "to pedal"._

## The problem

I plan cycling trips around Singapore with Strava and Ride with GPS, and both fall short:

- **Strava** puts route building behind a paid subscription.
- **Both** behave like a *database of other people's rides* that gets recommended to me.
  Neither makes it easy to say "start here, pass through A, B and C, end there" and get a
  sensible route back, or to ask "suggest me a nice 40 km loop from home".
- **Neither knows what a good path in Singapore looks like.** I don't want to road cycle.
  I want Park Connectors (PCN), dedicated cycling paths and wide roadside paths, and I want
  to stay off roads wherever I can.

The real bottleneck is **data**: no app exposes "this segment is PCN / a proper cycling path /
a wide shared path / a road" in a way I can plan with.

## What this project is

A personal, Singapore-only route planner where **path quality is the main thing it optimises
for**:

1. **Network map:** see at a glance where the good riding is (PCN, cycling paths, shared paths,
   roads), colour-coded.
2. **Waypoint routing:** tap a start, any number of stops and an end, and get the nicest
   route through them, not just the shortest one. Drag to adjust.
3. **Suggestions:** loops of a target distance from a start point, "via these places"
   with the stop order optimised, and the named PCN loops as ready-made templates.
4. **Route facts:** distance, estimated time, % on PCN / cycling path / road, number of
   road crossings, water points and toilets along the way. Export GPX to any other app.

## What it is not (for now)

- Not a social app or a ride database. No feeds, kudos or leaderboards.
- Not road-cycling-first. Roads are a last resort the router uses when it has to.
- Not global. Singapore only, which keeps the data small enough to run entirely in the
  browser.
- Not a native app. It's a mobile-first web app (PWA). Dispatch showed that a free Apple account
  makes native iOS apps expire every 7 days.

## Key facts gathered on day 1

**Data sources (all free):**

| Source | What it gives | Notes |
|---|---|---|
| **OpenStreetMap** (Geofabrik `malaysia-singapore-brunei` extract, cut to SG) | Full rideable graph (roads, footpaths, cycleways) with tags | SG park connectors are often tagged `leisure=park_connector` + `bicycle=designated`. There is a PCN route relation (`route=bicycle`, `ref=PCN`, `network=rcn`). Coverage varies, so it must be verified. |
| **NParks Park Connector Loop** (data.gov.sg, GeoJSON) | Official PCN loop segments with `PCN_LOOP` names (e.g. "Northern Explorer Loop") | Mixed LineString / MultiLineString. Labelled "indicative" geometry. |
| **LTA Cycling Path Network** (data.gov.sg, GeoJSON/KML) | Cycling paths built by LTA and Town Councils | "Symbolic" lines, so they need snapping to OSM. Data dated July 2025. |
| **URA Master Plan park connector layers** (data.gov.sg) | Planned and existing connectors | Some layers are superseded, so check before using. |
| **OneMap API** (SLA) | SG address / postal code search; also has a routing API with a cycle mode | Useful for search and as a baseline to compare against. Routing needs a free account token. |
| **data.gov.sg real-time** | Rainfall, 2-hour forecast, hawker centres, etc. | For ride-day features later. |

data.gov.sg downloads use the same pattern for every dataset: call the poll-download endpoint
with the dataset ID, then fetch the URL it returns.

**Singapore rules that shape routing:**

- Bicycles are allowed on footpaths (10 km/h limit), shared paths and cycling paths (25 km/h).
  So footpaths are *legal but slow*. The router should treat them as usable, but cost them
  more than a cycling path.
- Bicycles are banned on expressways, so those are hard-excluded from the graph.

**Existing tools worth knowing:** Komoot, BRouter-web and cycle.travel all do waypoint
planning with surface-aware profiles. None of them knows about PCN or SG path quality
specifically, and that SG-specific knowledge is what this project adds.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Platform | Mobile-first web app (PWA) | No app-store or re-signing hassle. Works on the iPhone with GPS and wake lock. |
| Hosting | Cloudflare Pages (static) | Free. Same account as Dispatch. No server is needed for the MVP. |
| Routing | **Our own router in a Web Worker** over a precomputed SG graph | SG is small enough to route in the browser (a few MB gzipped). We fully control the path-quality weights, preference sliders re-route instantly, and running costs are $0. |
| Fallback router | Self-hosted BRouter or GraphHopper (custom model) on the Orange Pi | Use only if the Phase 0 spike shows our own router isn't good enough. |
| Data pipeline | Python, run offline on the Mac, outputs committed build artefacts | Data changes rarely, and a rebuild is a command, not a service. |
| Map | MapLibre GL JS + OpenFreeMap or OneMap basemap tiles | Free, vector, and lets us style our network overlay. |
| Workflow | Plain repo, no GSD | Same as desk-widget; switch to GSD later if wanted. |

## Decisions from the design discussion (21 Oct 2026)

| Topic | Decision |
|---|---|
| Name | **Kayuh** |
| Audience | Me + friends: accounts, crews, share links. No public launch. |
| Platform | Web app (PWA) now. The routing engine is a plain TS package so a later Expo app can reuse it. |
| On the ride | Follow mode with the screen on, plus **watch export**: GPX into Huawei Health (my GT 4) and Zepp (friend's Amazfit). Both support GPX route import. |
| Bike | **Rental bikes**: HelloRide (me) and Anywheel (friends). About 15 km/h. Footpaths OK but slow; avoid roads. |
| Pass | Both operators have month passes where **the first 30 min of each ride is free**. Routes are split into legs under 30 min (about 7 km), each ending at legal parking. |
| Parking | LTA requires shared bikes to end at designated parking ($5 fine otherwise), so every route end and stop snaps to legal parking. |
| Friends can | Open shared routes, plan group rides, see shared ride history. |
| Privacy | Rides are **private by default**. Sharing is opt-in per ride. Start and end are always trimmed. |
| Ride types | All four: one-way A to B, loops, errands, long explorations. |
| Accounts backend | Cloudflare Worker + D1 + R2. Not Supabase: its free tier pauses after a week idle. Sign-in with Google + email magic link. |
| Test routes | Proposed by Claude (see PLAN.md), can be amended. |
| Visual direction | Three directions drafted on the design canvas (calm map-first / warm local / bold sporty); to choose. |

## Still open

- [ ] Can a ride be ended and immediately restarted on the same bike, on both HelloRide and
      Anywheel? Pass-aware legs depend on it. Verify in real life.
- [ ] Pick a visual direction from the canvas.
- [ ] Does the GT 4 show turn prompts or only a breadcrumb line? Test in Phase 0.

## First session: what to do

Start **Phase 0** in [PLAN.md](PLAN.md). The full feature list is in [docs/FEATURES.md](docs/FEATURES.md): pull OSM + NParks + LTA data, render all three on one
map, and answer "how good is the data, really?" before writing any routing code.
