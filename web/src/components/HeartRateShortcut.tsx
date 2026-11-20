/** "Add heart rate from Apple Health": runs the iOS Shortcut, then merges what it sent (or what was pasted) onto the ride. Owner only. */
import { useEffect, useRef, useState } from "preact/hooks";
import { api, type RideDetail } from "../api.ts";
import { buildShortcutUrl, mergeHr, parseHrText, SHORTCUT_NAME, type HrSample } from "../healthShortcut.ts";
import { me, showToast } from "../state.ts";
import { analyse, encodeTrack, summary, type RideStats, type Sample, type TrackJson } from "../track.ts";
import { Close } from "./Icons.tsx";
import "./ride-health.css";

const SEEN_KEY = "kayuh.hrShortcutSeen";
const seen = () => { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private window */ } };

export function AddHeartRate({ ride, samples, onSaved }: {
  ride: RideDetail; samples: Sample[]; onSaved: (track: TrackJson, stats: RideStats) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [help, setHelp] = useState(false);
  const live = useRef({ waiting, busy });
  live.current = { waiting, busy };

  /** Merge readings onto the ride, recompute the stats and save. Throws a friendly message on failure. */
  const apply = async (hr: HrSample[]) => {
    if (!ride.track) throw new Error("This ride has no GPS track to add heart rate to.");
    if (!hr.length) throw new Error("No heart rate readings found. Check the shortcut ran and Health has data for this ride.");
    const merged = samples.map((s) => ({ ...s }));
    const matched = mergeHr(merged, Date.parse(ride.riddenAt), hr);
    if (matched < merged.length * 0.1) throw new Error("Those heart rate readings don't overlap this ride, so nothing was added.");
    const track = encodeTrack(merged, ride.track.L);
    if (!track) throw new Error("Couldn't rebuild the track");
    const phys = (await api.me().catch(() => null)) ?? me.value;
    const stats = summary(analyse(merged, ride.track.L, { physiology: phys, rpe: ride.rpe ?? null }));
    await api.putRideTrack(ride.id, { track, stats });
    await api.clearHrPending(ride.id).catch(() => {});
    showToast("Heart rate added");
    onSaved(track, stats);
  };

  const guard = async (job: () => Promise<void>) => {
    if (live.current.busy) return;
    setBusy(true);
    try { await job(); } catch (e) { showToast((e as Error).message); } finally { setBusy(false); }
  };

  const checkPending = () => guard(async () => {
    const rows = await api.hrPending(ride.id);
    if (!rows.length) { setEmpty(true); return; }
    await apply(rows.map((r) => ({ t: Date.parse(r.t), bpm: r.bpm })));
  });

  // Back from the Shortcuts app: look for what it sent. Also once on open, in case it finished while the app was closed.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && live.current.waiting) checkPending(); };
    document.addEventListener("visibilitychange", onVisible);
    api.hrPending(ride.id).then((rows) => { if (rows.length) checkPending(); }).catch(() => {});
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ride.id]);

  const run = () => guard(async () => {
    const url = await buildShortcutUrl(ride);
    setWaiting(true);
    setEmpty(false);
    location.href = url;
  });

  const paste = () => guard(async () => {
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { throw new Error("Couldn't read the clipboard. Allow paste when iOS asks, then try again."); }
    const hr = parseHrText(text);
    if (!hr.length) throw new Error("The clipboard has no heart rate readings. Run the shortcut first; it copies them.");
    await apply(hr);
  });

  return (
    <section class="watch-file">
      <button class="btn outline" disabled={busy} onClick={() => { if (!seen()) setHelp(true); else run(); }}>
        {busy ? "Working…" : "Add heart rate from Apple Health"}
      </button>
      {(waiting || empty) && (
        <div class="stack-8">
          <p class="muted small">{empty ? "Nothing has arrived yet. If the shortcut finished, paste what it copied:" : "Switch back to Kayuh when the shortcut says it's done."}</p>
          <button class="btn outline" disabled={busy} onClick={paste}>Paste heart rate</button>
        </div>
      )}
      <p class="muted small">
        Uses the "{SHORTCUT_NAME}" shortcut to read your watch's heart rate from Apple Health. <button class="link-btn" onClick={() => setHelp(true)}>Set up the shortcut</button>
      </p>
      {help && <ShortcutHelp onClose={() => { setHelp(false); markSeen(); }} onRun={() => { setHelp(false); markSeen(); run(); }} />}
    </section>
  );
}

function ShortcutHelp({ onClose, onRun }: { onClose: () => void; onRun: () => void }) {
  return (
    <div class="sheet-full" role="dialog" aria-label="Set up the Apple Health shortcut">
      <div class="search-head">
        <strong class="lg grow" style={{ alignSelf: "center" }}>Set up the Apple Health shortcut</strong>
        <button class="icon-btn" aria-label="Close" onClick={onClose}><Close /></button>
      </div>
      <div class="form-body">
        <p>A home-screen web app can't read Apple Health, so a small iPhone shortcut does it. You build it once.</p>
        <ol class="stack-8">
          <li>Open the Shortcuts app, tap + and name it exactly <b>{SHORTCUT_NAME}</b>.</li>
          <li>Add <b>Get Dictionary from Input</b>, then <b>Get Dictionary Value</b> three times for <b>start</b>, <b>end</b> and <b>url</b>.</li>
          <li>Add <b>Find Health Samples</b>: Type is Heart Rate, Start Date is between start and end, sorted by Start Date.</li>
          <li><b>Repeat with Each</b> sample: Text "Start Date (ISO 8601),Value". Then <b>Combine Text</b> with New Lines.</li>
          <li><b>Get Contents of URL</b> (the url value): POST, JSON body, field <b>samples</b> = the combined text.</li>
          <li><b>Copy to Clipboard</b> the combined text, then <b>Show Notification</b> "Heart rate sent".</li>
        </ol>
        <p class="muted small">The upload only works once the Cloudflare Access bypass for /api/hr/ is in place. Until then, switch back here and tap Paste heart rate: the clipboard copy works either way. Full steps are in docs/SHORTCUT.md.</p>
        <button class="btn primary" onClick={onRun}>I've set it up: run it now</button>
        <button class="btn outline" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
