# Kayuh goals (owner's list, 20 Nov 2026)

The order of work from here. PLAN.md keeps the original build phases. This file is the list going forward.
Watch details live in [WATCH.md](WATCH.md).

| # | Stage | Done when |
|---|---|---|
| 1 | Finish training data (Phase 2b) | Review and test fixes are in, goals are checked, migration 0009 is live and it's deployed |
| 2 | Watch integration, Huawei GT 4 first | Jaden can ride with the watch and see heart rate, effort and training in Kayuh without exporting files by hand |
| 3 | Owner testing round | Jaden tests training and watch features on real rides and reports bugs and QoL changes, which get fixed |
| 4 | Aesthetics | Specific pages, onboarding and the overall app look redesigned |
| 5 | Public app and monetisation | Public sign-in replaces Cloudflare Access, plus a business plan (deferred until 1–4 are done) |

## Stage 2: what the watch integration must do

There are two directions, both needed:

1. **Watch to Kayuh, free ride (like Strava).** Start a ride on the watch with no destination. Kayuh tracks it and keeps the
   GPS track, heart rate and effort as a training activity.
2. **Kayuh to watch, planned ride.** Plan a route in Kayuh, then ride with the watch showing speed, distance left,
   time left (and the 30-minute leg timer and next parking), and a small navigation map.

Constraints:
- Least manual work: no exporting files by hand as the normal path.
- Huawei GT 4 first, because that's the watch Jaden can test on. Amazfit, Garmin and others come later.

### Watch steps

| Step | What | Status |
|---|---|---|
| W0 | Owner checks | Watch is a **GT 4 (PNX-B19), HarmonyOS 5.0.0.88**, not a GT 4 Pro. Phone is an iPhone 17 on iOS 26.6. Heart rate reaches Apple Health: yes. Huawei **GPX and TCX** exports both have route, elevation and time but **no heart rate**. The Strava "Export Original" sample was recorded by the Strava iPhone app (FIT, GPS only, no heart rate), so it doesn't test the Huawei-to-Strava path. Huawei developer account: created. Free Apple account: OK, with a 7-day rebuild |
| W1 | Research spike (results in WATCH.md, "Update 20 Nov 2026") | Done 20 Nov |
| W2a | **Apple Health heart rate via iOS Shortcut.** When a Kayuh ride ends, Kayuh opens a "Kayuh heart rate" shortcut with the ride's time range and a short-lived upload token. The shortcut reads heart rate from Apple Health (which Huawei Health already fills) and posts it to Kayuh, where it's merged onto the ride. No Strava terms, no approvals, $0 | Next to build |
| W2b | **Strava auto-import for rides started on the watch.** Huawei Health syncs to Strava, a Strava webhook notifies Kayuh, and Kayuh fetches GPS and heart rate and creates or enriches the ride. Owner-only | After the owner's Strava test ride, and Strava's answer on their 7-day caching rule |
| W2c | **Planned ride on the watch without an app.** Kayuh GPX (with parking and leg waypoints) imported as a Huawei Health route, while Kayuh's phone screen keeps the leg timer | Owner test now |
| W3 | Live sensor API on the Worker (ride token, samples posted live) and live heart rate on the ride screen. Shares the upload token with W2a | Built only when a watch app exists (W4 or W6) |
| W4 | Huawei spike: a hello-world GT 4 app installed on Jaden's watch, plus an iPhone companion (free Apple account, weekly `rebuild.sh`) passing a message both ways. Go or no-go | Gated on Huawei's Wear Engine decision (1–2 weeks; individuals may be refused P2P) and on DevEco seeing a watch paired to an iPhone |
| W5 | Huawei watch app: free ride and planned ride modes (speed, distance and time left, leg timer, next parking, mini map) | After W4 says go |
| W6 | Other watches: Amazfit (Zepp OS, friend tests), Garmin, then one native app reading Apple Health / Health Connect for the public launch | Later |

### Data pathways

| From | To | Path | Manual? | What arrives | Status |
|---|---|---|---|---|---|
| Watch | Kayuh | Huawei Health, export GPX, import in Kayuh | Yes | Route, time, elevation. No heart rate | Works today |
| Watch | Kayuh | Huawei Health, export TCX, import | Yes | Route, time, elevation. No heart rate | Checked 20 Nov |
| Watch | Kayuh | Huawei Health, Strava (auto sync), Strava "Export Original", import | Yes | Whatever Huawei sent Strava, usually with heart rate | Not yet checked |
| Watch | Kayuh | Huawei Health, Strava (auto sync), Kayuh pulls it automatically | No | GPS, heart rate, cadence, time | W2 |
| Watch | Kayuh | Huawei Health, Apple Health, iOS Shortcut, Kayuh | One tap | Heart rate samples | W2 fallback |
| Watch | Kayuh | Kayuh watch app, Wear Engine, iPhone companion, Kayuh (live) | No | Live heart rate and position, ride start and stop | W4–W5 |
| Kayuh | Watch | Kayuh, GPX file, Huawei Health route import | Yes | Route line only | Original plan |
| Kayuh | Watch | Kayuh, iPhone companion, Wear Engine, Kayuh watch app | No | Route, legs, parking, targets for the on-watch display | W4–W5 |

Why the companion is needed: the GT 4 has no Wi-Fi or SIM, and a web app on iPhone can't use Bluetooth. So the only
way the watch can talk to the iPhone is through Huawei's Wear Engine, inside a native iPhone app. That conflicts with the
"no native app" rule in CLAUDE.md, so the owner decides: test with a free Apple account (rebuilt every 7 days), and pay
about US$99 a year only at public launch.

## Stage 4 notes (aesthetics)

Scope to agree on when we get there: specific pages (Jaden to list), onboarding, and an overall visual pass covering type,
colour, spacing, icons and empty states, keeping the Calm screens style.
