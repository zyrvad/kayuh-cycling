# Kayuh UI system (design pass, 21 Nov 2026)

The rules every screen follows. Tokens live in `web/src/styles.css` `:root`. Calm, native-feeling, light theme.
Design read: a mobile product app for a small group of Singapore riders, calm iOS-like language, restrained motion
(variance 4, motion 3, density 4). The ride-in-progress screen only picks up shared tokens.

## Information architecture

Tab bar (5): **Home · Map · Routes · Rides · Crew**. Profile isn't a tab: it opens from the avatar button at the
top right of every page header and of the map's search row (the Apple Fitness / App Store pattern). Settings is
its own page, opened from the gear on Profile, with a back button.

Screens (`Screen` in `state.ts`): `home` (new default), `discover` (Map), `plan`, `ride`, `freeride`, `routes`,
`rides`, `crew`, `me` (Profile), `settings`.

## Colour

| Token | Value | Use |
|---|---|---|
| `--accent` | #17804F (operator theme may tint it) | primary buttons, active tab, links |
| `--warm` | #E0752D | sunrise accent, sparingly: records, kudos, goal ring complete, highlights. Fill/icon only |
| `--warm-ink` | #A8461A | warm text on white (4.6:1) |
| `--warm-soft` | #FDF0E6 | warm tinted background |
| `--danger` | #B42318 | destructive text |
| `--danger-soft` | #FEF3F2 | destructive pressed state |
| `--brand` | #17804F | logo, launch screen. Never tinted by operator theme |

One accent per screen. No gradients except the existing status-bar shade. Shadows stay green-tinted (rgba of ink).

## Shape

- Cards and sheets: **18px** radius (`--r-card`). Sheets 22px top corners (unchanged).
- Buttons: **14px** (52 px tall) and **12px** (44 px tall, `.btn.sm`) (`--r-btn`, `--r-btn-sm`).
- Chips, pills, small segmented chips: full pill (999px).
- Primary segmented control: 12px track, 9px thumb (as today).

## Buttons (one system)

| Class | Look | Where |
|---|---|---|
| `.btn.primary` | filled `--accent`, white text | the one main action on a screen |
| `.btn.secondary` | surface fill, 1px `--line-2` border, ink text | second actions (`.btn.outline` stays as an alias) |
| `.btn.tertiary` | no fill or border, `--accent-deep` text | low-emphasis actions, "Remove photo", "See all" |
| `.btn.destructive` | no fill, `--danger` text | only inside menus, sheets and settings rows, never on a page body |
| `.btn.sm` | 44 px tall, 14px text, 12px radius | in headers, rows and cards |
| `.icon-btn` | 44×44 square, 12px radius | icon-only; always has `aria-label` |

- Every touch target is at least 44×44 px.
- Icons: 20 px inside buttons, 24 px in the tab bar, 18 px inside small pills. Use the existing `Icons.tsx` family
  (2 px stroke, round caps); add new glyphs there in the same style.
- `:active` gives `transform: scale(0.98)`. No hover-only affordances.
- Labels are 1-3 words, sentence case, never wrapping.

## Type

Figtree (already loaded). Page title 28/800, section title 17/700 (sentence case, not the uppercase eyebrow),
body 15/500, meta 13/500 `--muted`. The uppercase `.eyebrow` is rationed: at most one per screen.
Numbers in stat tiles use `font-variant-numeric: tabular-nums`.

## Cards

- **RouteCard** (`web/src/components/RouteCard.tsx`): the one card for anything with a line on a map (saved
  routes, rides, feed items, Home's last ride). A real basemap snapshot with the route drawn on it fills the top
  (16:9 by default), title and stats below, an optional action row or overflow menu. While the snapshot loads it
  shows the SVG `MiniMap` on `--soft`, so layout never jumps.
- Cards are used only for real objects (a route, a ride, a crew). Settings use grouped rows, not a card per field.

## Motion

- 180-240 ms `cubic-bezier(0.2, 0.8, 0.2, 1)` for sheets and fades; nothing loops except real progress.
- Everything collapses to instant under `prefers-reduced-motion: reduce`.

## Copy

Plain, short, sentence case, British spelling as the app already uses. No em dashes or en dashes in visible text.
No emoji.

## Layers (z-index)

map 0 · overlays on map 2 · sheets 3 · tab bar 4 · page header 5 · full sheets/dialogs 30 · status shade 40 ·
onboarding 60 · tour 79-81 · launch screen 100.
