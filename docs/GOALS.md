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
| W1 | Research spike: check the automatic heart-rate paths and the two-way Huawei path on iPhone (see below) | Proposed |
| W2 | Automatic heart rate with no watch app. Huawei Health syncs to Strava, Strava notifies Kayuh, and Kayuh pulls heart rate and attaches it to the matching ride (or creates one for a watch-only ride). Fallback: a one-tap iOS Shortcut that reads heart rate from Apple Health | Proposed |
| W3 | Live sensor API on the Worker (a ride token; the watch or companion posts samples) and live heart rate on the ride screen. Works for any brand | Drafted in WATCH.md section 6 |
| W4 | Huawei spike: a hello-world GT 4 app installed on Jaden's watch, plus an iPhone companion that passes a message both ways. Go or no-go | Needs the native-companion decision |
| W5 | Huawei watch app: free ride and planned ride modes | After W4 |
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
