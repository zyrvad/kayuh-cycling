# Watch data for Kayuh: decision document

Researched 16 Nov 2026. Nothing was built. Claims I could not confirm in an official source are tagged **[unverified]**. Forum posts and vendor blogs are tagged as such.

## Short answer

1. **This week, no code:** record a ride on the GT 4 Pro, export the workout file from Huawei Health (or upload to Strava and download the original), and import it into Kayuh. Check what Huawei Health writes to Apple Health.
2. **Next build:** a file import (GPX/TCX/FIT) that reads heart rate from the file and draws it on the ride page. This works for every brand and needs no approvals.
3. **Do not build a GT 4 Pro watch app or a live pipeline first.** The only supported way to move data off the watch to a phone goes through Huawei's Wear Engine, which needs Huawei approval plus a native iOS companion app; an iOS SDK exists but what it allows on a GT 4 Pro is unverified (section 1).
4. **Live data later:** a ride-token API on the Worker (section 6) is cheap and brand-neutral, and Amazfit and Garmin can feed it. Build it only once someone with one of those watches wants it.

## Summary table

| Brand | Live during ride? | After ride? | Needs | Approval / cost | Effort |
|---|---|---|---|---|---|
| Huawei GT 4 Pro (owner's) | Very unlikely on iPhone | Yes: file export, Apple Health | Huawei Health on iPhone | None for file route; Wear Engine needs Huawei developer approval; free | File import 2-3 days; watch app 2+ weeks, needs Huawei approval and a native iOS app |
| Amazfit (Zepp OS) | Yes, via device app + Side Service | Yes: file via Strava / Apple Health | Zepp OS watch, Zepp app, Node tooling | Free Zepp developer account; store review 1-5 working days (workout extensions) | 1-2 weeks |
| Garmin | Yes, via Connect IQ app | Yes: FIT file, Strava | Connect IQ SDK, Garmin Connect Mobile open on phone | Free to sideload; store review days to 2 weeks; developer must be 18+ | 1-2 weeks |
| Apple Watch | Yes (native) | Yes (HealthKit) | Native iOS + watchOS app | Paid Apple Developer account, about $99 a year **[unverified, from memory]** | 3+ weeks |
| Wear OS | Yes (native) | Yes (Health Connect) | Android app | Google Play fee, about $25 once **[unverified, from memory]** | 3+ weeks |

## 1. Huawei WATCH GT 4 Pro

**Can a third-party app run on it?** Yes, in principle. The GT series is a "lite wearable". Apps are JavaScript, CSS and HML, built in DevEco Studio ([Huawei lite wearable guide, community article](https://medium.com/huawei-developers/huawei-lite-wearable-application-development-using-huawei-deveco-studio-hamonyos-6c65346dab78)). Huawei's own developer page lists the GT 4 among Wear Engine-compatible lite watches. I did not find the GT 4 Pro named separately; it is the same family, so likely, but **[unverified]**. The [Wear Engine intro (search summary)](https://developer.huawei.com.cn/consumer/en/doc/development/connectivity-Guides/service-introduction-0000000000018585) is the page to check.

**Heart rate.** The OpenHarmony `@system.sensor` module is the lite-wearable API and includes `subscribeHeartRate` ([OpenHarmony docs](https://gitcode.com/openharmony/docs/blob/master/en/application-dev/reference/apis-sensor-service-kit/js-apis-system-sensor.md)). I could not open the page's permission details (rate-limited). Whether it streams continuously for 1-2 hours with the screen off is **[unverified]**. Lite wearable apps are generally foreground-oriented, so assume a long ride is the hard part until proven.

**Getting data off the watch.** Huawei's [Wear Engine getting-started page](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/dev-process-0000001051058039) says:
- You must apply for Wear Engine permission in AppGallery Connect, after developer identity verification, before you can debug.
- The phone app is built with Android Studio, or Xcode 12+ for iOS 13+ with Huawei Health installed. **An iOS SDK does appear to exist:** Huawei's [phone SDK page](https://developer.huawei.com/consumer/en/doc/connectivity-Library/phone-sdk-cn-0000001656844234) lists an iOS download (`iOS_WearEngineSDK_1.0.0.305.zip`), and there is a community [SwiftUI sample for Wear Engine on iOS](https://github.com/Explore-In-HMOS/wear-engine-ios-to-watch-file-message) covering watch messaging and file transfer. What it can do on a GT 4 Pro (messages and files from your own watch app; heart-rate streaming is listed for enterprise developers only) is **[unverified]**. Testing needs a real iPhone, not the simulator.
- Huawei Health must be installed and paired on the phone.
- I found nothing on watch-side direct network access (fetch) for lite wearables. **[unverified]**

So a GT 4 Pro app talking to Kayuh would need Wear Engine, a native iOS companion, and Huawei approval. The iOS SDK exists, but whether it works with the GT 4 Pro for your use is unverified.

**Installing a test build on your own watch.** Per the community guide ([DEV article on running and debugging](https://dev.to/harmonyos/running-debugging-harmonyos-apps-on-huawei-watches-a-complete-setup-guide-for-developers-4903)): install DevEco Assistant and Huawei Health on the phone, read the watch's UDID, register it in AppGallery Connect, create a debug certificate and provision profile, then install over the phone. Wi-Fi debugging via the watch's IP is also described. Those guides mostly cover newer Watch-series models, so GT 4 Pro specifics are **[unverified]**.

**Sideloading an iOS companion with a free Apple account.** Possible for your own phone (apps expire after 7 days, which matches your repo's own constraint). That only helps if the companion has an SDK to call, and it does not.

## 2. Huawei without a watch app

- **Apple Health.** Huawei's App Store listing says exercise data can sync to HealthKit ([App Store listing](https://apps.apple.com/cz/app/huawei-health/id1325481372)). Heart rate is not named there. A vendor ([Sahha](https://sahha.ai/integrations/huawei-health/), a commercial source) says steps, heart rate, workouts, weight and sleep are written, with sleep as total duration only. App Store reviews report gaps, for example active energy. **Heart rate in workouts is [unverified]; you can check it in a minute: Health app > Sources > Huawei Health after a ride.** Setup path is Huawei Health > Me > Third party services > HUAWEI Health Kit > Link.
- **Export a file.** Users report Huawei Health can export GPX, with one reviewer noting an offset of about 1 km in the track ([summary of search results](https://androidauthority.com/how-to-sync-huawei-health-with-strava-3182027/)). **GPX export on iOS, and whether it carries heart rate, are [unverified].** Test it on a real ride. A GPS offset would hurt Kayuh's path-quality matching, so compare against the route you actually rode.
- **Strava.** Huawei Health connects to Strava, and Strava needs heart-rate permission granted for HR to pass through ([Huawei support, via search](https://consumer.huawei.com/es/support/content/es-es15919588/)). Strava lets you download your own original file from the web activity page (Export Original), but I did not re-check this; **[unverified]**. Strava's API terms forbid showing one user's data to others, so this path stays owner-only.

## 3. Amazfit (Zepp OS)

Architecture ([Zepp docs](https://docs.zepp.com/docs/guides/architecture/arc/)):
- **Device App** runs on the watch, draws UI and reads sensors.
- **Side Service** runs inside the Zepp phone app and can call external servers with fetch.
- They talk over Bluetooth with `this.request` / `onRequest` and `this.call` / `onCall`.

Heart rate comes from the device-app [HeartRate sensor API](https://docs.zepp.com/docs/v2/reference/device-app-api/newAPI/sensor/HeartRate/), permission `data:user.hd.heart_rate`. For background work, the docs describe an App Service with no UI, and continuous running depends on the `device:os.bg_service` permission ([App Service](https://docs.huami.com/docs/guides/framework/device/app-service/)). Exact behaviour during a long workout is **[unverified]**.

So the full chain is: watch reads HR, sends to Side Service, which POSTs to the Worker. That is exactly your friend's kind of app, and it needs no Huawei-style approval. A third-party example of live streaming exists ([HypeRate blog](https://blog.hyperate.io/post/amazfit-heart-rate-push-live-bluetooth-heart-rate-streaming-with-zepp-os-hyperate-compatible/), a vendor post).

Install on your own watch: sign in to the Zepp app, switch on Developer Mode, run the `zeus preview` command to get a QR code, and scan it in the app ([quick start](https://docs.zepp.com/docs/guides/quick-start/preview/)). Public distribution: Zepp developer console, upload and review of 1-5 working days according to the [workout extension distribution page](https://docs.huami.com/docs/guides/workout-extension/distribute/). I did not find the plain mini program page, so treat that timing as **[unverified]** for ordinary apps.

## 4. Garmin

- **Connect IQ** apps and data fields are written in Monkey C. They can read heart rate and record to the activity (details not confirmed this session, **[unverified]**).
- **Web requests.** `Communications.makeWebRequest` goes through Garmin Connect Mobile on the phone. On iPhone, forum reports say Connect Mobile must be running, at least in the background, or you get a BLE error (-104), and there are iOS-specific bugs ([Garmin forum](https://forums.garmin.com/developer/connect-iq/f/discussion/4503/communications-makewebrequeston-iphone/30741), community reports, varying SDK versions).
- **Sideloading** for personal use: copy the .prg file into the watch's `GARMIN\APPS` folder. Some newer firmware has rejected sideloads ([forum](https://forums.garmin.com/developer/connect-iq/f/discussion/367718/sideload-prg-file-no-longer-working)).
- **Store review.** Apps are reviewed after upload ([Garmin submit page](https://developer.garmin.com/connect-iq/submit-an-app)). Garmin says up to three days, but developers report up to two weeks in Oct 2026 ([the5krunner](https://the5krunner.com/2026/10/16/connect-iq-store-delays/)). The developer must be 18 or over. Selling needs a $100 yearly merchant account; free apps seem not to.
- **Approval.** I found no per-app approval gate like the paused Connect Developer Program. The Connect IQ SDK is separate. Confirm before relying on it **[unverified]**.

## 5. Apple Watch and Wear OS

Not researched in depth; this is from general knowledge and **[unverified]** here. An Apple Watch needs a native watchOS plus iOS app (HealthKit, a workout session for background heart rate) and a paid Apple Developer account. Wear OS needs a native Android app using Health Services, with data synced through Health Connect or a phone relay. In both cases the PWA cannot do this alone, which your repo already notes. A native wrapper reading Apple Health or Health Connect would cover many brands at once, including Huawei and Amazfit if they write to those stores.

## 6. Kayuh-side design for live data

Brand-neutral, with the PWA and Worker as the hub.

1. **Start.** At ride start the signed-in PWA calls `POST /api/rides/:id/sensor-token`. The Worker stores a random token (hashed) with the ride id, user id and expiry, and returns a 6-character code and a QR. The code is for typing on the watch; the QR is for phone-side apps.
2. **Upload.** The watch app (or its phone-side service) sends `POST /api/sensor/:code` with batches such as `[{t, hr, cadence, power}]`, one batch every 10-15 seconds, each at most about 50 samples.
3. **Merge.** When the ride ends, the PWA fetches `GET /api/rides/:id/sensor` and merges by timestamp onto the GPS track. During the ride it can poll every 10 seconds if you want a live display.

**Auth.** The token can only append samples to that one ride, and it cannot read anything. Expiry about 6 hours, or at ride end. A 6-character code has only about 2 billion combinations, so rate-limit bad guesses per IP and expire quickly, or use a longer token for the QR path.

**Privacy.** Heart rate is health data. Store it owner-only, exclude it from crew sharing and the social feed by default, apply the same first and last 200 m trim rules, and delete the raw samples when the ride is deleted. Never put it in GPX shared with others.

**Rate limits and cost.** At one batch per 10 seconds, a 2 h ride is about 720 requests. The Workers free plan allows about 100,000 requests a day and D1 free allows roughly 100,000 row writes a day ([Cloudflare limits docs](https://developers.cloudflare.com/workers/platform/limits/), figures from memory, **[unverified]**). Storing one JSON blob per batch rather than a row per sample keeps writes low. Several friends riding daily would still be far below the limits, so cost stays at $0.

## 7. Recommendation

| Rank | Path | Value | Effort | Accounts / cost |
|---|---|---|---|---|
| 1 | No-code test this week: check Apple Health sources, export a workout from Huawei Health, try Strava original download | Tells you what data you can actually get | 1 hour | None |
| 2 | GPX/TCX/FIT import with heart-rate chart on ride page | Works for every brand, covers your watch today | 2-3 days | None |
| 3 | Ride-token API (section 6) | Foundation for any live watch app | 2-3 days | None, $0 |
| 4 | Amazfit or Garmin watch app | Live HR for friends with those watches | 1-2 weeks each | Free dev accounts; Garmin test needs the watch |
| 5 | Native wrapper reading Apple Health or Health Connect | Cross-brand, public app | 3+ weeks | About $99 a year Apple account |
| 6 | Huawei GT 4 Pro watch app | You can test it, but the iPhone route is blocked | 2+ weeks, uncertain | Huawei developer approval |

Why not Huawei first: you can only test on the GT 4 Pro, but the data path to an iPhone is the weak link. Do the file route, then decide using what the file contains.

**Before building anything, confirm these** (all quick): does a Huawei workout export contain heart rate; is the GPS offset real; does heart rate appear in Apple Health; does the iOS Wear Engine SDK (1.0.0.305) support the GT 4 Pro for messages and files.
