# Apple Health heart rate shortcut

Gets your watch's heart rate (Huawei Health writes it into Apple Health) onto a Kayuh ride. A home-screen web app cannot read Apple Health, so an iOS Shortcut does it.

Status: the Worker side and the in-app flow are tested in code. **Everything on the iPhone (building the shortcut, the `shortcuts://` launch, Cloudflare Access bypass) is untested** until you try it.

## How it works

1. On an own-ride page with no heart rate, tap **Add heart rate from Apple Health**.
2. Kayuh asks the Worker for a one-ride token (valid 24 h) and opens `shortcuts://run-shortcut?name=Kayuh%20heart%20rate&input=text&text=...`. The text is JSON: `{"start": "<ride start ISO>", "end": "<ride end ISO>", "url": "https://kayuh.zyrvad.workers.dev/api/hr/<token>"}`.
3. The shortcut reads heart rate between start and end, POSTs it to `url`, and also copies it to the clipboard.
4. You switch back to Kayuh (iOS cannot return to a home-screen app by itself). Kayuh finds the upload, merges it onto the ride, recomputes the stats and shows "Heart rate added".
5. If nothing arrived (no Access bypass yet), tap **Paste heart rate**: Kayuh reads the clipboard copy and does the same.

## Build the shortcut (once)

Open the Shortcuts app, tap **+**, name it exactly `Kayuh heart rate`. Add these actions in order:

1. **Receive** input: set to accept **Text** (Shortcut Input). With `input=text` Kayuh passes the JSON as text.
2. **Get Dictionary from Input** (Input: Shortcut Input).
3. **Get Dictionary Value** for key `start`. Rename the result variable `Start` (long-press the blue output, Rename).
4. **Get Dictionary Value** for key `end` from the Dictionary. Name it `End`.
5. **Get Dictionary Value** for key `url` from the Dictionary. Name it `URL`.
6. **Get Dates from Input** with Input = `Start`. Name it `StartDate`.
7. **Get Dates from Input** with Input = `End`. Name it `EndDate`.
8. **Find Health Samples**. Add filters: **Type** is **Heart Rate**; **Start Date** is **between** `StartDate` and `EndDate`. Sort by **Start Date**, order **Oldest First**. Limit off (or at least 20000).
9. **Repeat with Each** item in Health Samples:
   1. **Format Date**: Date = Repeat Item's **Start Date**, Date Format **Custom**, format string `yyyy-MM-dd'T'HH:mm:ssXXX`. (If Custom is not offered, choose **ISO 8601**.)
   2. **Text**: `Formatted Date,Repeat Item Value`. Insert the Formatted Date variable, a comma, and the Repeat Item's **Value**.
   3. End Repeat.
10. **Combine Text** with Repeat Results, separator **New Lines**. Name it `Combined`.
11. **Get Contents of URL**: URL = `URL`; **Method** POST; **Request Body** JSON; add a field **Text** named `samples` with value `Combined`. (Shortcuts sets `Content-Type: application/json`, which the Worker requires.)
12. **Copy to Clipboard**: `Combined`.
13. **Show Notification**: "Heart rate sent. Switch back to Kayuh".

First run: iOS asks for permission to read Heart Rate in Health and to send data to the host. Allow both. Settings › Shortcuts › Advanced › "Allow Sharing Large Amounts of Data" may need to be on if iOS blocks the large upload.

Optional: if the Get Contents of URL step fails (no bypass), it shows an error; the clipboard step is skipped unless you set the step's error handling or put Copy to Clipboard **before** Get Contents of URL. Putting the copy first is the safer order.

## Cloudflare Access bypass (needed for the automatic upload)

The whole site sits behind Cloudflare Access, so a Shortcut POST is blocked at the edge. Add a bypass for the upload path only:

1. Cloudflare dashboard › **Zero Trust** › **Access** › **Applications** › **Add an application** › **Self-hosted**.
2. Application name `Kayuh heart rate upload`. Domain `kayuh.zyrvad.workers.dev`, path `api/hr`.
3. Add a policy: name `Bypass HR upload`, action **Bypass**, include **Everyone**.
4. Save. Access applies the most specific path, so `api/hr` is exempt and the rest stays protected.

This does not open your data. The Worker still checks the token in the URL: it must match a stored SHA-256 hash, belong to a ride you own, and be under 24 h old. Unknown or expired tokens get 404. An upload is limited to 1 MB / 50,000 lines, 25 to 250 bpm, and times within 10 minutes of the ride; it can only add pending heart rate for that one ride, and returns no ride data. Only you can read it back (`GET /api/rides/:id/hr-pending` needs your sign-in).

Without the bypass, the clipboard fallback still works today.

## Troubleshooting

- "Nothing has arrived yet": the upload was blocked or the shortcut had no samples. Use **Paste heart rate**.
- "readings don't overlap this ride": the dates were read in the wrong time zone or the watch had not synced to Health yet. Open Health, check there are heart rate points for that time, then rerun.
- Dates in the clipboard text: Kayuh accepts ISO lines (`2026-11-21T07:02:13+08:00,123`) and also Shortcuts' default format (`21 Nov 2026 at 7:02:13 AM,123`, read as phone local time).
