# Design pass: morning review (21 Nov 2026)

Branch `claude/design-pass-2afa28`, rebased onto local `main` (the Apple Health commit). Not pushed, not deployed,
no migrations. Everything below runs locally: `cd worker && npx wrangler dev --port 8791` after `cd web && npm run build`,
then `npx tsx web/scripts/seed-dev.mjs` for realistic local data (four riders, a crew, rides on real SG routes).

Rules every screen now follows: [SYSTEM.md](SYSTEM.md). Screenshots are 375×812 phone shots taken with
`node web/scripts/screens.mjs` (headless Chrome), before in [screens/before](screens/before), after in
[screens/after](screens/after).

## 1. Logo: pick one

Chosen 21 Nov 2026: option 2 (connector-loop).

Open [preview.html](preview.html) (home screen at 180 and 60 px on light and dark wallpaper, favicon at 32 and 16 px,
wordmark on white and green). Five options in [options/](options/), each with `icon.svg`, `mark.svg`, `wordmark.svg`,
`icon-192.png`, `icon-512.png` and an opaque `apple-touch-icon.png`.

**Recommendation: option 4, "wordmark" (the y-path).** A lowercase y whose tail runs off as a path and ends at an
orange start dot. It's the only one that says "Kayuh" rather than "a cycling app", it's simple enough to hold at 60 px,
and the matching lowercase "kayuh" wordmark gives the brand something to own. The single orange dot is the one warm
touch, echoing the sunrise accent now used for records and kudos.

| Option | Verdict |
|---|---|
| 1 crank-k | Clever idea, but the chainring bowl makes the K read as an R at small sizes |
| 2 connector-loop | A true loop can't also be a k; the closed counter reads as a triangle |
| 3 wheel-route | Generic; spokes turn to mush at 16 px; looks a bit like a unicycle |
| **4 wordmark** | **Recommended.** Distinct, ownable, legible at 60 px |
| 5 leaf | Pleasant but reads as an eco app (as the brief warned) |

At 16 px the y's tail thins out: before swapping, consider a favicon-16 variant with a thicker, shorter tail.

To swap (one step, once you pick): copy `options/<n>/icon.svg`, `icon-192.png`, `icon-512.png` into `web/public/`,
point `apple-touch-icon` in `web/index.html` at the option's `apple-touch-icon.png` (copy it to `web/public/`), and
replace the inline `<svg class="splash-mark">` in `web/index.html` with the option's `mark.svg` (white).

## 2. Screens

| Screen | Before | After | What changed |
|---|---|---|---|
| Launch | (none) | after/01-01-launch | Logo on brand green with a real progress bar (graph bytes + map load); fades in 240 ms; hides on load, never after 8 s. Manifest background matches |
| Welcome | before/01-onboarding | after/02-01b, 03-01c, 04-01d | 3 skippable cards: what Kayuh is, 30-minute legs and legal parking (with the bike choice), location and compass with the reason |
| Tour | (none) | after/05-01e-tour-home | 13-step spotlight tour across tabs (ported from AI-GNITION's tour.js). Skip, Back, Next, Done, "n of 13". Missing targets are skipped, survives rotation, respects reduced motion. Runs once (localStorage); Settings > Help > Replay tour |
| Home (new first tab) | (none) | after/06-02-home | Greeting, conditions line (moved from the map), Plan a ride and Free ride, week goal ring, last ride map card, latest crew activity. Fits one 375×812 screen |
| Map | before/02-map-sheet, 03-map-collapsed | after/07-03-map-half, 08-03b-collapsed, 09-03c-full, 10-03d-conditions | Sheet has three detents (collapsed = one summary line, half, full) with drag, flick and tap. Weather chips replaced by one compact conditions pill that expands on tap |
| Plan | before/04-plan-route | after/11-04-plan-route | Unchanged apart from shared tokens and tour hooks |
| Routes | before/05-routes | after/12-05-routes, 13-05b-routes-more | Map-background cards (real basemap snapshot with the line), Ride as the primary action, Share, and a More menu with Send to watch and Delete (confirmed) |
| Rides | before/06, 07, 08 | after/14-06, 15-07, 16-08 | Activities \| Training is the full-width primary control; Mine \| Crew are small chips under it; Import is a compact header button; ride cards use the map card |
| Ride detail | before/09-ride-detail | after/17-09-ride-detail | Unchanged apart from tokens |
| Crew | before/10, 11, 12 | after/18-10, 19-11, 20-12, 21-12b, 22-12c | Feed cards use the map card (kudos given turns warm). "Leave crew" moved into a crew settings sheet (gear) as a quiet destructive action with a confirm step |
| Profile (was Me) | before/13-me-top | after/23-13, 24-14 | Avatar, name, following/followers (opens Friends), Share follow link, this week and this year, personal records, recent rides. Opened from the avatar at the top right of every page |
| Settings | before/14-me-bottom | after/25-15, 26-16 | Its own page behind the gear: Bike and pass, Route preferences, Heart rate and power, Apple Health heart rate (Set up the shortcut, from main's W2a work), Privacy (private account), Help (Replay tour), Account, Data |
| Free ride (new) | (none) | after/27-17-free-ride | Record with no destination: time, distance, speed, free-minutes countdown (warns in the last 5), nearest legal parking, pause, finish with confirm, saved as a normal ride. Survives a reload |
| Ride in progress | | | Untouched, as asked |

All buttons follow one system (primary filled, secondary outline, tertiary text, destructive red text only in
sheets/menus/settings), 44 px touch targets, radii 18 cards / 14 and 12 buttons / pill chips.

## 3. Decisions I took (say if you disagree)

- **Tabs are Home, Map, Routes, Rides, Crew.** Six tabs don't fit; Profile moved to the avatar in each page header
  (the Apple Fitness / App Store pattern) rather than losing Routes.
- **"Map background" cards are real map snapshots**, rendered by one hidden map and cached (memory + Cache API).
  Shared rides keep the server's 200 m trim, so snapshots never show anyone's start or finish.
- **Free ride is a new screen**, not a change to the ride screen, so the ride-in-progress screen stays exactly as it was.
- **Tour "seen" flag is localStorage only.** An account flag needs a D1 migration; not worth it tonight.
- **Sunrise orange (#E0752D) is a second accent, used sparingly**: personal records, kudos you gave, a met goal, the
  logo's start dot.
- **Operator colours kept.** The app still takes HelloRide's blue / Anywheel's green as its accent. Most people pick
  HelloRide, so the app is mostly blue while the brand is green. I'd recommend keeping brand green for the app and
  showing the operator colour only on the bike badge; it's a one-line change in `state.ts` (THEMES effect). Your call.

## 4. Left to do / known gaps

- Check on a real iPhone: sheet drag and flick (touch), the second WebGL context used for map snapshots, the compass
  prompt on the welcome card, safe areas, standalone launch colour.
- Training log day cells are 32 px wide (under 44); widening needs a layout change in Training.tsx.
- Training "Delete goal" has no confirm step; the Friends panel still uses `window.confirm()` (3 places).
- The conditions popover on the map sits over the legend while open.
- No dark mode (the app is light only; out of scope for this pass).
- Graph size constants in `router.worker.ts` (progress bar fallback) need updating when the graph is rebuilt.

## 5. Verification

Final branch, after the rebase onto local `main` (f1a4326, Apple Health heart rate):

| Suite | Result |
|---|---|
| web `tsc --noEmit` + `npm test` | clean, 51 pass |
| web `npm run build` | OK (chunk-size warning only, as before) |
| worker `tsc --noEmit` + `npm test` | clean, 66 pass |
| packages/router `tsc` + `npm test` + `npm run golden` | clean, 11 + 11 golden pass |

Rebase: two conflicts, both resolved keeping both sides. Routes keeps the new cards and its More menu now uses
main's real GPX export for Send to watch. Plan keeps main's "Send to watch (GPX)" button with the tour hooks added.
The pre-rebase state is kept as branch `design-pass-prerebase` (delete it once you're happy).

Reviewed once by a read-only reviewer: no privacy or crash issues; seven smaller defects fixed (snapshot map cleanup
and back-off, free ride save guard / Back target / wake lock / lazy init, crew leave error path, router load errors
now surface instead of "Loading…" forever). Checked by hand after the rebase: Routes More menu, Settings > Apple
Health shortcut help.

Not checked: anything on a real iPhone, and the deployed site (nothing was deployed).
