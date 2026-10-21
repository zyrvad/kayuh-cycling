# Travel-time model

Google Maps cycling estimates in Singapore are optimistic: real rides take about 1.5–2× as long
(Jaden's experience), mostly because Google ignores waits at traffic lights. Kayuh's model
(`packages/router/src/profile.ts`) adds those waits explicitly:

| Factor | Value |
|---|---|
| Cruising speed (rental bike) | 13 km/h (setting) |
| Footpaths (legal 10 km/h, pedestrians) | 8 km/h |
| Unpaved | ×0.8 speed |
| Traffic lights | 40 s average wait, counted once per set of lights (signal nodes within 40 m merge) |
| Zebra/uncontrolled crossings | 8 s |
| Sharp turns (≥ 60°) | 4 s |
| Re-park between legs (lock, scan QR, unlock) | 90 s |
| Walking to/from parking | 4.5 km/h, shown separately |
| Personal pace | median of your recorded rides' actual ÷ predicted (0.7–1.8×), once you have 2+ |

## Calibration (21 Oct 2026, nicest route, no parking snap)

| Route | Google | Kayuh | Lights | Kayuh ÷ Google |
|---|---|---|---|---|
| East Coast Park → Changi Village | 56 min · 16.7 km | 107 min · 16.3 km | 17 | 1.91× |
| Punggol Point → Waterway Point | 8 min · 2.7 km | 18 min · 2.4 km | 4 | 2.19× |
| Rail Corridor: Buona Vista → Bt Timah | 21 min · 5.2 km | 29 min · 5.1 km | 2 | 1.36× |
| Kallang → Gardens by the Bay | 18 min · 4.2 km | 20 min · 4.0 km | 0 | 1.11× |
| Tampines MRT → Bedok Reservoir | 12 min · 4.1 km | 24 min · 4.0 km | 4 | 1.98× |
| Bishan MRT → Toa Payoh Central | 15 min · 4.8 km | 21 min · 2.5 km | 3 | 1.38× |
| Jurong East MRT → Jurong Lake Gdns | 13 min · 2.7 km | 21 min · 3.0 km | 2 | 1.65× |
| Sengkang MRT → Punggol Waterway | 10 min · 3.3 km | 24 min · 3.1 km | 4 | 2.37× |
| Woodlands MRT → Admiralty Park | 7 min · 1.9 km | 12 min · 1.8 km | 2 | 1.76× |
| Orchard → Marina Barrage | 29 min · 6.3 km | 50 min · 7.3 km | 7 | 1.73× |

Median 1.73–1.76× (the old model: 1.55×, range 0.92–1.93×). The spread is partly Google's own:
its implied speed ranges from 12.5 km/h (Jurong) to 20.5 km/h (Tampines). The old model also
double-counted lights on divided roads (34 → 17 on the Changi route).

Ground truth should replace this proxy: rides followed with GPS store actual vs predicted time,
and "Learn my pace" applies the ratio.
