/** Bringing watch files into Kayuh: import a whole ride, or add heart rate and power to a ride Kayuh recorded. */
import { useRef, useState } from "preact/hooks";
import type { LonLat } from "@kayuh/router";
import { api, type RideDetail } from "../api.ts";
import { type ImportedActivity, mergeSensors, parseActivity, positioned, TooLong } from "../importers.ts";
import { sample as thinLine } from "../matching.ts";
import { rideTitle } from "../places.ts";
import { router } from "../routerClient.ts";
import { me, openRide, showToast } from "../state.ts";
import { analyse, encodeTrack, summary, type Analysis, type RideStats, type Sample, type TrackJson } from "../track.ts";
import { duration, encodePolyline, km } from "../util.ts";
import { Close, Upload } from "./Icons.tsx";
import "./ride-health.css";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".gpx,.tcx,.fit";
const UNREADABLE = "Couldn't read that file. Kayuh reads GPX, TCX and FIT files from your watch or bike computer.";

/** Parse a picked file, with a friendly message when it isn't a usable activity. */
async function readFile(file: File): Promise<ImportedActivity> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is over 20 MB, which is too big for Kayuh to read. Export just the one ride.");
  try {
    return parseActivity(await file.arrayBuffer());
  } catch (e) {
    throw e instanceof TooLong ? e : new Error(UNREADABLE);
  }
}

/** Physiology for the training numbers: fresh from the server, else what the app already has. */
async function physiology() {
  return (await api.me().catch(() => null)) ?? me.value;
}

interface Prepared {
  title: string; riddenAt: string; samples: Sample[]; a: Analysis; tierM: number[]; line: LonLat[];
}

async function prepare(file: File): Promise<Prepared> {
  const act = await readFile(file);
  const pos = positioned(act.samples);
  if (pos.length < 2) throw new Error("That file has no GPS track, so there's no route to show. Indoor rides can't be imported yet.");
  // The ride starts at its first position, not at a heart-rate-only record before it.
  const t0 = pos[0].t;
  const samples = pos.map((s) => ({ ...s, t: s.t - t0 }));
  const line = samples.map((s) => s.ll);
  const tiers = await router.classify(line).catch(() => [] as number[]);
  samples.forEach((s, i) => { s.tier = tiers[i] ?? -1; });
  const phys = await physiology();
  const a = analyse(samples, [0], { physiology: phys });
  const tierM = [0, 0, 0, 0, 0, 0];
  for (let i = 1; i < samples.length; i++) if (samples[i].tier >= 0) tierM[samples[i].tier] += a.cumM[i] - a.cumM[i - 1];

  // "Landmark → landmark" when the router's places know both ends, else the file's own name.
  const fileName = file.name.replace(/\.[^.]+$/, "");
  const guess = await rideTitle("Start → End", line[0], line[line.length - 1]).catch(() => "Start → End");
  const title = guess !== "Start → End" ? guess : act.name || fileName || "Imported ride";
  return { title, riddenAt: new Date(act.startMs + t0 * 1000).toISOString(), samples, a, tierM: tierM.map(Math.round), line };
}

/** "Import ride" button and the preview sheet that follows a picked file. */
export function ImportRide({ onSaved, compact }: { onSaved: () => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pick = async (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    el.value = ""; // so the same file can be picked again
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const p = await prepare(file);
      setTitle(p.title);
      setPrep(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!prep) return;
    setBusy(true);
    try {
      const { a, samples } = prep;
      const { id } = await api.logRide({
        name: title.trim().slice(0, 80) || "Imported ride", riddenAt: prep.riddenAt, distanceM: Math.round(a.distanceM), timeS: Math.round(a.movingS),
        tierM: prep.tierM, polyline: encodePolyline(thinLine(prep.line, 1500)), source: "gpx",
        track: encodeTrack(samples), stats: summary(a),
      });
      setPrep(null);
      showToast("Ride imported");
      onSaved();
      openRide(id);
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input ref={input} type="file" accept={ACCEPT} class="visually-hidden-input" tabIndex={-1} aria-hidden="true" onChange={pick} />
      {compact
        ? <button class="btn secondary sm" data-tour="rides-import" disabled={busy} onClick={() => input.current?.click()}><Upload />{busy && !prep ? "Reading…" : "Import"}</button>
        : <button class="btn secondary" disabled={busy} onClick={() => input.current?.click()}>{busy && !prep ? "Reading file…" : "Import ride"}</button>}
      {error && <div class="banner warn">{error}</div>}
      {prep && (
        <div class="sheet-full" role="dialog" aria-label="Import ride">
          <div class="search-head">
            <strong class="lg grow" style={{ alignSelf: "center" }}>Import ride</strong>
            <button class="icon-btn" aria-label="Close" onClick={() => setPrep(null)}><Close /></button>
          </div>
          <div class="form-body">
            <label class="field">Title
              <input value={title} maxLength={80} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
            </label>
            <div class="import-facts">
              <div class="import-fact"><span>Date</span><b>{new Date(prep.riddenAt).toLocaleString("en-SG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</b></div>
              <div class="import-fact"><span>Distance</span><b>{km(prep.a.distanceM)} km</b></div>
              <div class="import-fact"><span>Moving time</span><b>{duration(prep.a.movingS)}</b></div>
              {prep.a.avgHr !== undefined && <div class="import-fact"><span>Average heart rate</span><b>{prep.a.avgHr} bpm</b></div>}
            </div>
            <p class="muted small">The ride is private. You choose who sees it from the ride page.</p>
            <button class="btn primary" disabled={busy || !title.trim()} onClick={save}>{busy ? "Saving…" : "Save ride"}</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Add heart rate, cadence and power from a watch file to a ride Kayuh recorded (matched by clock time). */
export function AddWatchFile({ ride, samples, onSaved }: {
  ride: RideDetail; samples: Sample[]; onSaved: (track: TrackJson, stats: RideStats) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    el.value = "";
    if (!file || !ride.track) return;
    setBusy(true);
    try {
      const act = await readFile(file);
      if (!act.samples.some((s) => s.hr !== null || s.cad !== null || s.power !== null)) {
        showToast("That file has no heart rate, cadence or power readings.");
        return;
      }
      const merged = samples.map((s) => ({ ...s }));
      const matched = mergeSensors(merged, Date.parse(ride.riddenAt), act);
      if (matched < merged.length * 0.1) {
        showToast("The times in that file don't overlap this ride, so nothing was added.");
        return;
      }
      const track = encodeTrack(merged, ride.track.L);
      if (!track) throw new Error("Couldn't rebuild the track");
      const stats = summary(analyse(merged, ride.track.L, { physiology: await physiology(), rpe: ride.rpe ?? null }));
      await api.putRideTrack(ride.id, { track, stats });
      showToast("Watch data added");
      onSaved(track, stats);
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="watch-file">
      <input ref={input} type="file" accept={ACCEPT} class="visually-hidden-input" tabIndex={-1} aria-hidden="true" onChange={pick} />
      <button class="btn secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Adding…" : "Add watch file"}</button>
      <p class="muted small">Adds heart rate and power from a GPX, TCX or FIT file of the same ride, matched by clock time.</p>
    </section>
  );
}
