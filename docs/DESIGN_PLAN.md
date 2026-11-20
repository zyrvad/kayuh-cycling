# Design plan: brand, onboarding, pages (stage 4 in GOALS.md)

Written 21 Nov 2026 from the owner's notes. Aim: a calm, confident app that feels native and has a brand worth
showing. Avoid anything flashy: no gradients everywhere, no glassmorphism, no bouncing animations.
Keep the existing Calm screens tokens (`web/src/styles.css`: green `--accent #17804F`, ground `#EEF1EC`) unless the
brand work below changes them deliberately.

## Owner's notes (verbatim intent)

- The logo isn't striking or good enough for a brand. Suggest alternatives.
- Onboarding should go section by section through the app, highlighting functions with a step-by-step popup. Model it
  on the guided tour in the owner's AI-GNITION project (`~/Development/AI IGNITION/renewwell/site/js/tour.js` and
  `.tour-*` in `site/styles.css`). It dims the page, cuts a spotlight hole around one element, and shows a small
  popup with "n of N", Skip, Back and Next. It walks across pages, runs once per visitor and blocks page clicks while
  it runs.
- **Map page:** the pull-up/down sheet feels odd and doesn't fully close. The weather chips (cloudy, temperature,
  sunset) feel oddly placed.
- **Routes page:** use the same card format as shared rides (map background card).
- **Crew page:** OK, but feed cards are missing the map background.
- **Rides page:** the Activities | Training switch and the Mine | Crew switch need a visual hierarchy.
- **Buttons:** some look wrong, e.g. "Import ride" on Rides and "Leave crew" on Crew.
- **Me page:** should feel like a profile page. Settings should be a separate page reached from the profile.
- **Ride-in-progress page:** already good. Don't change it beyond shared tokens.
- **Loading screen** when the app opens, and a **home screen**, to feel more app-like.

## A. Brand and logo

The current icon is a green rounded square with a white route line, a dot and a "P" parking box. It's readable but
generic, the P box looks like a traffic sign, and nothing in it says "Kayuh".

Deliver five directions as SVGs in `docs/brand/options/`, plus `docs/brand/preview.html`. The preview shows each one
as an iOS home-screen icon at 60 px and 180 px, on light and dark wallpaper, beside the wordmark, and at 16 px
favicon size. Starting points:

1. **Crank K.** The letter K drawn as a crank arm and pedal on a chainring arc. Says "to pedal" directly.
2. **Connector loop.** A single continuous path line that forms a lowercase k with a loop. It reads as a park
   connector seen from above.
3. **Wheel route.** A bicycle wheel whose spokes resolve into a route line leaving the rim.
4. **Wordmark.** A custom lowercase "kayuh" wordmark whose y descender becomes a path. The icon uses just the "k" or
   "y".
5. **Garden-city leaf.** A leaf whose midrib is a winding path, for Singapore's City in Nature. Tie-breaker only;
   this may read as an eco app.

For each: a one-line rationale, how it survives at 16 px, and a colour proposal. Consider one warm secondary accent
(sunrise orange) next to the green for brand energy, used sparingly (records, kudos, highlights). **Recommend one,
but don't replace the live icon.** The owner picks in the morning. Prepare the swap as a one-step change: generated
`icon-192.png`, `icon-512.png`, `icon.svg` and an apple-touch icon per option in its folder.

## B. Launch screen and home

- **Launch screen:** the logo centred on the brand colour while the graph (`graph.bin`) and the map load, with a
  slim real progress indicator (not a fake spinner). Fade into the app within about 300 ms. Match the manifest
  `background_color` so the iOS standalone launch flows straight into it. Never block longer than the actual load.
- **Home tab** (new first tab; the map stays its own tab). It should hold:
  - a greeting;
  - two big actions: **Plan a ride** and **Free ride** (record with no destination);
  - this week's goal ring and distance;
  - the last ride as a map card;
  - the latest crew activity, one card;
  - a small conditions line (weather, sunset), moved here from the map.

  Keep it to one scroll on a 375×812 phone.

## C. Onboarding

Replace the current `web/src/components/Onboarding.tsx` slides with two parts:

1. **Welcome**, 2 or 3 short full-screen cards: what Kayuh is, the rental-bike 30-minute legs and legal parking, and
   location/compass permission with the reason. Each card is skippable.
2. **Guided tour** (`web/src/tour.ts`, a port of AI-GNITION's `tour.js` into Preact): a veil, a spotlight hole and a
   popup. It switches tabs as it goes and highlights one control per step:
   - Home actions;
   - map search, stops and the path-type colours;
   - Plan with Send to watch;
   - saved routes;
   - the Ride button;
   - Rides: Activities | Training, then Import;
   - Crew: Feed and Crews;
   - Profile and Settings.

   Show "n of N", Skip, Back, Next and Done. Run it once per user (localStorage plus an account flag if cheap), and
   replay it from Settings ("Replay tour"). Make it survive missing elements (skip the step) and rotation or resize.
   Respect reduced motion.

## D. Page fixes

| Page | Fix |
|---|---|
| Map | The bottom sheet gets real detents: collapsed (handle plus one summary line), half and full. Dragging or flicking down fully collapses it. The handle area is generous. Weather and sunset chips move to Home, or into a single compact conditions pill on the map that expands on tap |
| Routes | Saved routes use the shared map-background card (same component as ride/feed cards), with the actions (Ride, Send to watch, Share, Delete) in a consistent row or menu |
| Crew | Feed cards get the map background (reuse the card); "Leave crew" moves into a crew settings sheet as a quiet destructive action, with a confirm step |
| Rides | Primary level: Activities \| Training as a full-width segmented control under the title. Secondary level: Mine \| Crew as small chips below it. "Import ride" becomes a secondary icon-plus-label button in the header or an overflow menu, not a big block |
| Me → Profile | Shows avatar, name, follow/followers counts and the follow link, this week's and this year's stats, personal records and recent activities. A gear icon opens **Settings** (bike and pass, routing preferences, physiology, privacy, Apple Health shortcut, replay tour, sign out) |
| All | One button system: primary (filled), secondary (outline), tertiary (text) and destructive (red text, only inside menus or sheets). Consistent icon sizes, 44 px touch targets, and the same corner radii |

## E. Process for the design session

- Use the `taste-skill` (design-taste-frontend) skill. Look at a few calm references online (for example Apple
  Fitness, Komoot, Strava profile and Bento-style home screens) and note what's borrowed.
- Take before and after screenshots at 375×812 for every page touched, with the browser pane visible. A hidden pane
  stops MapLibre loading.
- Keep all suites passing: web, worker, router unit and golden tests, typecheck and build.
- Work on the session's own branch. Don't deploy or push to main. Leave a review note listing every screen, its
  screenshots and the logo recommendation.
