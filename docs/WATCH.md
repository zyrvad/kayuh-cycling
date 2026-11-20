# Watch data for Kayuh: decision document

Two parts: the 20 Nov update (GT 4 on iPhone, the current plan), then older notes kept for later watches (Amazfit, Garmin, the live-data design). Claims not confirmed in an official source are tagged **[unverified]**. Nothing here was built or tested on the watch.

## Update 20 Nov 2026: GT 4 on iPhone, two-way plan

Owner's setup: HUAWEI WATCH GT 4 (PNX-B19, HarmonyOS 5.0.0.88; **not** a GT 4 Pro), iPhone 17 on iOS 26.6, Huawei developer account just created. No Android phone. Huawei Health writes workout heart rate to Apple Health; its GPX and TCX exports have no heart rate.

### Bottom line

1. **Best automatic heart-rate path: Huawei Health, Strava, Kayuh (W2).** No watch app, no Apple developer cost, no Huawei approval. Unchecked: whether Huawei sends heart rate to Strava (one-ride test, to-do 1). Caveat: Strava's June 2026 API policy limits caching to 7 days (see C2).
2. **Fallback: iOS Shortcut** reading Apple Health and POSTing to Kayuh. Works, one tap. An automatic trigger for Huawei-written workouts is unlikely.
3. **Huawei watch app and live data (W4/W5) is high risk, and may be impossible on an iPhone alone.** Three open blockers, any of which can stop it: (a) Huawei's page says individual developers can only apply for the device-info and notification permissions, and P2P messaging ("communications management") is not on that list; (b) whether a debug app can be installed on a GT 4 paired with an iPhone is not confirmed anywhere official; (c) the GT 4 is a lite wearable, so the app is limited JS and its background behaviour for a 1-2 h ride is unknown. W4 stays a go/no-go spike, started only after the 1-2 week permission wait tells us about (a).
4. **No Android phone is required by any documented step for the iOS route**, but nothing official proves the route works from end to end on iPhone. A borrowed Android phone with Huawei Health is the fallback for step A3 only. **[unverified]**

### A. Huawei GT 4 on iPhone

**A1. Can third parties build GT 4 apps?** Yes, in principle. Huawei lists the GT series as lite wearables built in DevEco Studio with JS, CSS and HML ([lite vs wearable](https://medium.com/huawei-developers/what-are-the-differences-between-lite-wearable-and-wearable-devices-cf521ae0602e), community; [Huawei wearable app hub](https://developer.huawei.com/consumer/en/multidevice/wearables/get-started/), page did not load fully). I found no official statement of the API level for the GT 4 on HarmonyOS 5.0, and newer ArkTS tooling is described for Watch 5 / "Smart Next" devices rather than GT ([DevEco 5.1 wearable guide](https://dev.to/harmonyos/deveco-studio-510-build-and-run-your-first-harmonyos-wearable-app-on-huawei-watch-5-40mc), community). Assume lite-wearable JS. **API level: [unverified].** What would settle it: the lite wearable API reference and Huawei's supported-device list in DevEco, or opening a lite project and seeing whether the GT 4 appears as a target.

**A2. Watch-side APIs** (all **[unverified]** for the GT 4 specifically):
- Heart rate: `@system.sensor` `subscribeHeartRate` ([OpenHarmony reference](https://gitcode.com/openharmony/docs/blob/master/en/application-dev/reference/apis-sensor-service-kit/js-apis-system-sensor.md)). Long-ride behaviour unknown.
- GPS: `@system.geolocation` exists in the lite API family. Not checked for the GT 4.
- Canvas for a mini map, storage, vibration: the lite JS API family has canvas, file and vibrator modules. Not checked for the GT 4.
- Keeping the app alive for 1-2 h with the screen off: unknown. Lite apps are foreground-oriented. The biggest technical risk.
- Messaging to the phone: only through Wear Engine P2P. Messages from the iOS side are limited to **1 KB each** ([Wear Engine iOS send message](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/phone-send-message-ios-0000001875158886)). **File transfer is not supported on iOS** (same page). A route would need chunking.
- The watch has no Wi-Fi or SIM direct path to Kayuh. **[unverified]**

**A3. Installing a debug build on a GT 4 paired with an iPhone.** Only a community guide covers it ([running and debugging on Huawei watches](https://dev.to/harmonyos/running-debugging-harmonyos-apps-on-huawei-watches-a-complete-setup-guide-for-developers-4903)): enable developer options on the watch (tap software version 5-6 times), read the UDID, register the UDID in AppGallery Connect, create a debug certificate and profile, connect DevEco Studio over Wi-Fi, run. Huawei support pages are reported to say that managing apps on the watch is not supported when paired with an iPhone ([Huawei support](https://consumer.huawei.com/en/support/content/en-us15771217), the page I fetched did not state this; search summary only). So whether DevEco can push to a GT 4 that is paired to an iPhone is **open**. What settles it: follow the guide as far as the UDID and Wi-Fi debug step; if DevEco sees the watch, it works. DevEco Studio runs on a computer, so no Android phone is needed for the install itself. **[unverified]**

**A4. Wear Engine iOS SDK.**
- Latest on Huawei's SDK page: **1.0.0.305** (earlier 300, 301, 302, 304) ([phone SDK download](https://developer.huawei.com/consumer/en/doc/connectivity-Library/phone-sdk-cn-0000001656844234)). The page gives no release notes, device list or background behaviour.
- Requirements: Xcode 12+, iOS 13+, real iPhone, Huawei Health installed and the watch paired to it ([getting started](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/dev-process-0000001051058039)). The simulator is not supported.
- What works: a community sample ([wear-engine-ios-to-watch-file-message](https://github.com/Explore-In-HMOS/wear-engine-ios-to-watch-file-message)) shows two-way P2P messages, device discovery, ping and install check on GT, Fit and Watch-series wearables paired via Huawei Health. It needs a client ID, client secret and scheme secret from AppGallery Connect and a Huawei OAuth step. The GT 4 itself is not named on the pages I could read (Huawei's service overview is said to list it as a lite watch; that page returned an error). **GT 4 support: [unverified].**
- Permissions: apply in AppGallery Connect, App services, Development, Wear Engine, with a data-usage description and user-authorisation path; review "may take one to two weeks" ([applying for Wear Engine](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/applying-wearengine-0000001050777982)). **Individual developers can only apply for basic device information and message notification** (same page). Heart-rate/wearing-status and device serial are enterprise only. P2P is not in the individual list. Whether iOS P2P really needs a separate permission is not clear, as the iOS send page only asks for DEVICE_MANAGER. Applying is the only way to find out.
- Background: not documented. The watch cannot launch the iOS app. **[unverified]**, assume the iOS app must be open or recently active.

**A5. Huawei Health Kit cloud/REST (a no-Strava, no-watch-app route).** The REST API exists and has a workout heart-rate data type (`com.huawei.instantaneous.exercise_heart_rate`), OAuth with a server app, and an endpoint on `health-api.cloud.huawei.com` (summarised from search results; see [Health Service Kit overview](https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/overview-0000001177423513)). Heart rate is a restricted scope needing manual review; the integration guide describes application materials and an enterprise introduction, with a 15-working-day wait, and test scopes limited to 100 users ([access process](https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/access-process-0000001624467736)). A third-party article says individuals can apply; the official page I could read does not say. **Individual eligibility and Singapore availability: [unverified], open.** What would settle it: the "Qualifications Requirements for Developers" page and the Health Service Kit card in the console. Low priority: Strava gives the same result sooner.

**A6. Developer console next steps.** See the owner to-do list below.

### B. iPhone companion with a free Apple account

**B1. Limits.** Profiles expire after 7 days; 3 apps per device; 3 devices and 10 App IDs per week; reinstall by rebuilding ([Apple membership comparison](https://developer.apple.com/support/compare-memberships/), [Expo summary](https://expo.dev/blog/apple-developer-program-explained-free-vs-paid)). Expo's summary says HealthKit, Background Modes and App Groups work on a free account; Push, iCloud, Sign in with Apple, NFC and in-app purchases do not. I did not check Apple's own capability table, so **HealthKit and background modes on free: [unverified]**. Background location and Bluetooth modes are Info.plist background modes, so they should be fine, but a free profile cannot be used for TestFlight, and there is no push.

**B2. Rebuild routine.** Local check (read-only): Xcode is installed, `xcode-select -p` is `/Applications/Xcode.app/Contents/Developer`, `xcodebuild -version` is **Xcode 26.0.1** (build 17A400). The phone runs iOS 26.6, and an Xcode this old may not have device support for it, so an Xcode update may be needed first **[unverified]**. Simplest routine: plug in or use wireless debugging, open the project, press Run, once per week. For a script, one command pair does the same (**[unverified]**, from memory; test once): `xcodebuild -project Kayuh.xcodeproj -scheme Kayuh -destination 'id=<UDID>' -allowProvisioningUpdates build`, then `xcrun devicectl device install app --device <UDID> <path-to>.app`. A Saturday calendar reminder plus a `rebuild.sh` is enough. SideStore and AltStore are not simpler for one person with a Mac. Using the same bundle ID each time keeps app data.

### C. Strava automatic path

**C1. Huawei Health to Strava with heart rate?** Reviews say yes for cycling and other workouts, and that you must grant Strava's heart-rate permission first ([Android Authority guide](https://androidauthority.com/how-to-sync-huawei-health-with-strava-3182027/), [Wareable](https://www.wareable.com/smartwatches/how-to-sync-huawei-and-strava)). Strava's own page covers the link only: Huawei Health, Me, Privacy Management, Data Sharing and Authorization, Strava; the region list includes Asia Pacific ([Strava support](https://support.strava.com/en-us/articles/15401666-huawei-health-and-strava)). It does not say heart rate is included. Only workouts recorded after linking sync. **Heart rate included: [unverified] until the owner's test ride.**

**C2. Strava API.**
- Webhooks: create, update and delete events for activities, including `object_id` and `owner_id`; callback must return 200 within 2 seconds; one subscription per app ([webhooks](https://developers.strava.com/docs/webhooks/)). The event carries no data, so Kayuh then fetches the activity.
- Streams: the API reference lists time, distance, latlng, altitude, heartrate, cadence, power (watts), temperature, moving, grade and velocity streams ([API reference](https://developers.strava.com/docs/reference/)). The endpoint form is `GET /activities/{id}/streams?keys=...` **[unverified, from memory]**. Heart rate exists only if the file had it.
- Capacity: a new app starts in "Single Player Mode" with capacity 1, which covers only its owner. Raise to 10 in the dashboard; more needs review ([rate limits](https://developers.strava.com/docs/rate-limits/)). Limits: 200 requests per 15 minutes and 2,000 per day overall (100 and 1,000 non-upload) at the default tier. Plenty for one rider.
- Terms: the API policy effective 1 Jun 2026 says data about a user may be shown only to that user (§2.3), bars AI/ML use (§5.3), and **limits cached data to 7 days (§6.2)** ([API policy](https://www.strava.com/legal/api_policy)). Keeping data owner-only meets the display rule. The 7-day cache rule conflicts with keeping Strava-sourced activities as permanent training history. The policy carves out small apps (§6.1) but my fetch did not say how. **Open: email developers@strava.com, or treat Strava as import-and-convert.** Strava data must never reach the crew feed.

**C3. Export Original.** On the activity page on strava.com, three-dots menu, "Export Original" downloads the file as uploaded (often FIT); "Export GPX" includes heart rate if present; TCX via `/export_tcx` on the activity URL ([Strava export help](https://support.strava.com/hc/en-us/articles/216918437-Exporting-Your-Data-and-Bulk-Export), search summary). The owner's earlier sample was recorded by Strava itself, so it proved nothing about Huawei.

### D. iOS Shortcuts fallback

**D1. Read and POST heart rate.** Shortcuts has Find Health Samples and Get Contents of URL (POST with JSON), and community shortcuts export heart-rate samples this way ([Cassinelli](https://matthewcassinelli.com/shortcuts/export-heart-rate-data/), [heartbridge](https://github.com/mm/heartbridge)). Selecting "Workouts" as a sample type is reported unreliable ([forum](https://talk.macpowerusers.com/t/struggling-to-extract-workout-data-from-watch-via-shortcuts/39152)), so query Heart Rate between the ride start and end times, which Kayuh knows. **Works for Huawei-written samples: [unverified]**, test once. Large ranges may need batching or downsampling to stay small.

**D2. Launch from a web page.** Apple documents `shortcuts://run-shortcut?name=<name>&input=text&text=<text>` ([Apple](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios)). Returning to the page uses x-callback-url, which Apple documents on a separate page I did not read (**[unverified]**). Triggers: the Workout automation is labelled for "Apple Watch Workout" with Start, End or Both ([Apple](https://support.apple.com/guide/shortcuts/apd932ff833f/ios)), and forum users report the End trigger not firing even for Apple Watch workouts. **Firing for Huawei-written workouts: [unverified], likely no.** Plan on one tap from Kayuh's ride page, which opens the shortcut with the ride's time range and a short-lived upload token as text input.

### Data pathways

| Direction | Path | Manual / auto | Data that arrives | Needs | Status |
|---|---|---|---|---|---|
| Watch to Kayuh | Huawei Health, Strava, Strava webhook, Kayuh fetches streams | Auto | GPS, time, altitude, HR (if Strava has it), cadence | Strava app (single athlete), Huawei-Strava link, Strava heart-rate permission | W2. HR in Strava unchecked. 7-day cache policy risk |
| Watch to Kayuh | Strava, Export Original, import | Manual | Whatever Strava has | Nothing | Works; test once |
| Watch to Kayuh | Apple Health, Shortcut, POST to Kayuh | One tap | HR samples only; join to the GPS ride by time | Shortcut, upload token | W2 fallback. Workout trigger unlikely |
| Watch to Kayuh | Huawei Health Kit REST | Auto | Workouts and workout HR | Huawei approval, likely enterprise | Open, low priority |
| Watch to Kayuh | GT 4 app, Wear Engine, iPhone app, Worker (live) | Auto | Live HR and GPS, start/stop | Permissions, install route, native app, 7-day rebuild | W4 spike. Three blockers above |
| Kayuh to watch | GPX file, Huawei Health route import | Manual | Route line only | Nothing | Original plan; not tested on GT 4 |
| Kayuh to watch | Kayuh, iPhone app, Wear Engine P2P (1 KB messages), GT 4 app | Auto | Route, legs, parking, targets | As above | W4 to W5. Same blockers |

### Recommended build order (maps to docs/GOALS.md)

1. **W2 first, in this order.** (a) Owner runs the Strava test ride (to-do 1). (b) If heart rate is present: build Strava OAuth, webhook, streams fetch, and attach to a matching ride or create a ride; owner-only, never in crew sharing; settle the 7-day cache question first (email Strava). (c) Build the Shortcut fallback with a ride upload token in parallel; it reuses the W3 token idea.
2. **W3** (ride token and live sensor API on the Worker): proceed. It is useful for any brand and does not depend on Huawei.
3. **W4 is a gated spike.** Gates: Wear Engine application result (1-2 weeks), DevEco can see the GT 4. If P2P is refused for individuals or the install fails on iPhone, stop and either borrow an Android phone to test the install, or park the Huawei app and put effort into W6 (Amazfit/Garmin), where free developer tools allow live data.
4. **Planned-ride display without a watch app** may be a better Huawei route: Kayuh's GPX plus parking waypoints to Huawei Health's route import, and Kayuh's own on-phone screen for the 30-minute leg timer. Not tested.
5. **W5, W6** as in GOALS.md.

### Owner to-do

- [ ] 1. In Huawei Health, link Strava (Me, Privacy Management, Data Sharing and Authorization, Strava). Allow heart-rate in Strava's permission screen first. Record one short ride on the watch, then on strava.com open the activity, check it shows a heart-rate graph, and do Export Original.
- [ ] 2. Huawei developer console: finish identity verification (individual). Do not paste credentials anywhere.
- [ ] 3. In AppGallery Connect: create a project; add an app (iOS if offered, with the planned bundle ID, or Android as a placeholder if the console requires it); apply for the HUAWEI ID service if the app list is empty.
- [ ] 4. App services, Development, Wear Engine: Apply. Request device information and communications (P2P) and message notification; write the data use as "own-use fitness companion; no data shared". Note whether the form refuses P2P for individuals and send us the exact wording. Review is 1-2 weeks.
- [ ] 5. Optional: look up Health Service Kit's qualification page; note whether individuals can apply.
- [ ] 6. On the watch: check Settings, About for a developer-mode toggle by tapping the version (per the community guide); do not enable anything yet.
- [ ] 7. Update Xcode to a version that supports iOS 26.6 before W4, and turn on Developer Mode on the iPhone.
- [ ] 8. Email developers@strava.com the 7-day cache question (we can draft it).
- [ ] 9. Run the Shortcut test: Find Health Samples for Heart Rate, last hour, after a ride. Confirm Huawei Health samples appear.

## Later: Amazfit (Zepp OS)

Architecture ([Zepp docs](https://docs.zepp.com/docs/guides/architecture/arc/)):
- **Device App** runs on the watch, draws UI and reads sensors.
- **Side Service** runs inside the Zepp phone app and can call external servers with fetch.
- They talk over Bluetooth with `this.request` / `onRequest` and `this.call` / `onCall`.

Heart rate comes from the device-app [HeartRate sensor API](https://docs.zepp.com/docs/v2/reference/device-app-api/newAPI/sensor/HeartRate/), permission `data:user.hd.heart_rate`. For background work, the docs describe an App Service with no UI, and continuous running depends on the `device:os.bg_service` permission ([App Service](https://docs.huami.com/docs/guides/framework/device/app-service/)). Exact behaviour during a long workout is **[unverified]**.

So the full chain is: watch reads HR, sends to Side Service, which POSTs to the Worker. That is exactly your friend's kind of app, and it needs no Huawei-style approval. A third-party example of live streaming exists ([HypeRate blog](https://blog.hyperate.io/post/amazfit-heart-rate-push-live-bluetooth-heart-rate-streaming-with-zepp-os-hyperate-compatible/), a vendor post).

Install on your own watch: sign in to the Zepp app, switch on Developer Mode, run the `zeus preview` command to get a QR code, and scan it in the app ([quick start](https://docs.zepp.com/docs/guides/quick-start/preview/)). Public distribution: Zepp developer console, upload and review of 1-5 working days according to the [workout extension distribution page](https://docs.huami.com/docs/guides/workout-extension/distribute/). I did not find the plain mini program page, so treat that timing as **[unverified]** for ordinary apps.

## Later: Garmin

- **Connect IQ** apps and data fields are written in Monkey C. They can read heart rate and record to the activity (details not confirmed this session, **[unverified]**).
- **Web requests.** `Communications.makeWebRequest` goes through Garmin Connect Mobile on the phone. On iPhone, forum reports say Connect Mobile must be running, at least in the background, or you get a BLE error (-104), and there are iOS-specific bugs ([Garmin forum](https://forums.garmin.com/developer/connect-iq/f/discussion/4503/communications-makewebrequeston-iphone/30741), community reports, varying SDK versions).
- **Sideloading** for personal use: copy the .prg file into the watch's `GARMIN\APPS` folder. Some newer firmware has rejected sideloads ([forum](https://forums.garmin.com/developer/connect-iq/f/discussion/367718/sideload-prg-file-no-longer-working)).
- **Store review.** Apps are reviewed after upload ([Garmin submit page](https://developer.garmin.com/connect-iq/submit-an-app)). Garmin says up to three days, but developers report up to two weeks in Oct 2026 ([the5krunner](https://the5krunner.com/2026/10/16/connect-iq-store-delays/)). The developer must be 18 or over. Selling needs a $100 yearly merchant account; free apps seem not to.
- **Approval.** I found no per-app approval gate like the paused Connect Developer Program. The Connect IQ SDK is separate. Confirm before relying on it **[unverified]**.

## Later: Apple Watch and Wear OS

Not researched in depth; this is from general knowledge and **[unverified]** here. An Apple Watch needs a native watchOS plus iOS app (HealthKit, a workout session for background heart rate) and a paid Apple Developer account. Wear OS needs a native Android app using Health Services, with data synced through Health Connect or a phone relay. In both cases the PWA cannot do this alone, which your repo already notes. A native wrapper reading Apple Health or Health Connect would cover many brands at once, including Huawei and Amazfit if they write to those stores.

## Kayuh-side design for live data (W3)

Brand-neutral, with the PWA and Worker as the hub.

1. **Start.** At ride start the signed-in PWA calls `POST /api/rides/:id/sensor-token`. The Worker stores a random token (hashed) with the ride id, user id and expiry, and returns a 6-character code and a QR. The code is for typing on the watch; the QR is for phone-side apps.
2. **Upload.** The watch app (or its phone-side service) sends `POST /api/sensor/:code` with batches such as `[{t, hr, cadence, power}]`, one batch every 10-15 seconds, each at most about 50 samples.
3. **Merge.** When the ride ends, the PWA fetches `GET /api/rides/:id/sensor` and merges by timestamp onto the GPS track. During the ride it can poll every 10 seconds if you want a live display.

**Auth.** The token can only append samples to that one ride, and it cannot read anything. Expiry about 6 hours, or at ride end. A 6-character code has only about 2 billion combinations, so rate-limit bad guesses per IP and expire quickly, or use a longer token for the QR path.

**Privacy.** Heart rate is health data. Store it owner-only, exclude it from crew sharing and the social feed by default, apply the same first and last 200 m trim rules, and delete the raw samples when the ride is deleted. Never put it in GPX shared with others.

**Rate limits and cost.** At one batch per 10 seconds, a 2 h ride is about 720 requests. The Workers free plan allows about 100,000 requests a day and D1 free allows roughly 100,000 row writes a day ([Cloudflare limits docs](https://developers.cloudflare.com/workers/platform/limits/), figures from memory, **[unverified]**). Storing one JSON blob per batch rather than a row per sample keeps writes low. Several friends riding daily would still be far below the limits, so cost stays at $0.

