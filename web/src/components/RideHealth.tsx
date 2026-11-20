/** The training sections of a ride page: effort prompt, Relative Effort, heart rate, power and matched rides. Owner only. */
import { useMemo, useState } from "preact/hooks";
import { type Ride, type RideDetail } from "../api.ts";
import { matchedRides } from "../matching.ts";
import { me, rideDetail } from "../state.ts";
import { HR_ZONE_LABEL, POWER_CURVE_S, POWER_ZONE_LABEL, relativeEffort, type Analysis, type Sample } from "../track.ts";
import { duration, maxOf } from "../util.ts";
import { Chart } from "./Rides.tsx";
import "./ride-health.css";

const HR_COLORS = ["#9AA39E", "#6DB98A", "#E3A21A", "#D9541E", "#B3261E"];
const POWER_COLORS = ["#9AA39E", "#6DB98A", "#17804F", "#E3A21A", "#D9541E", "#B3261E", "#7A1F5C"];
const RPE_LABEL: Record<number, string> = { 1: "Very easy", 3: "Easy", 5: "Steady", 7: "Hard", 10: "All out" };

export const effortLabel = (e: number) => (e < 25 ? "Easy" : e < 75 ? "Moderate" : e < 150 ? "Hard" : "Very hard");
const mins = (s: number) => (s < 60 ? (s > 0 ? "<1 min" : "0 min") : `${Math.round(s / 60)} min`);
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });

interface Props {
  ride: RideDetail;
  a: Analysis | null;
  samples: Sample[] | null;
  cursor: number | null;
  onCursor: (i: number | null) => void;
  /** Save the 1-10 rating (null clears it). */
  onRpe: (rpe: number | null) => Promise<void>;
  /** The button that adds a watch file (only when the ride has a track). */
  watchFile?: preact.ComponentChildren;
}

export function RideHealth({ ride, a, samples, cursor, onCursor, onRpe, watchFile }: Props) {
  const [rating, setRating] = useState(false);
  const st = a ?? ride.stats;
  const hasHr = st?.avgHr !== undefined;
  const rpe = ride.rpe ?? null;
  const effort = a?.effort ?? st?.effort ?? relativeEffort(null, rpe, st?.movingS ?? ride.timeS);
  const ftp = me.value?.ftpW ?? null;

  return (
    <>
      {((!hasHr && rpe === null) || rating) && (
        <EffortPrompt rpe={rpe} onPick={async (n) => { await onRpe(n); setRating(false); }} onCancel={rating ? () => setRating(false) : undefined} />
      )}

      {effort !== null && effort !== undefined && (
        <section class="stack-8">
          <h2 class="section-title">Relative Effort</h2>
          <div class="health-effort">
            <span class="health-score">{effort}</span>
            <span class={`health-label ${effortLabel(effort).replace(" ", "-").toLowerCase()}`}>{effortLabel(effort)}</span>
          </div>
          <p class="muted small">
            {hasHr ? "Worked out from the time you spent in each heart-rate zone." : (
              <>Estimated from your effort rating of {rpe}/10 and moving time. <button class="link-btn" onClick={() => setRating(true)}>Change</button></>
            )}
          </p>
        </section>
      )}

      {st?.avgHr !== undefined && (
        <section class="stack-8">
          <h2 class="section-title">Heart rate</h2>
          <div class="health-stats">
            <div><small>Average</small><span><b>{st.avgHr}</b> bpm</span></div>
            <div><small>Max{a?.hrMax?.estimated ? " (est.)" : ""}</small><span><b>{st.maxHr ?? "–"}</b> bpm</span></div>
            {a?.hrMax && <div><small>Zones use</small><span><b>{a.hrMax.bpm}</b> bpm{a.hrMax.estimated ? " est." : ""}</span></div>}
          </div>
          {a?.hrMax?.estimated && <p class="muted small">Your max heart rate is estimated. Set your own in Me for accurate zones.</p>}
          {st.hrZones && <ZoneBar seconds={st.hrZones} labels={HR_ZONE_LABEL} colors={HR_COLORS} />}
          {a && samples && samples.some((s) => s.hr !== null) && (
            <Chart a={a} values={samples.map((s) => s.hr)} unit="bpm" color="#B3261E" cursor={cursor} onCursor={onCursor} />
          )}
        </section>
      )}

      {st?.avgPower !== undefined && (
        <section class="stack-8">
          <h2 class="section-title">Power</h2>
          <div class="health-stats">
            <div><small>Average</small><span><b>{st.avgPower}</b> W</span></div>
            <div><small>Max</small><span><b>{st.maxPower ?? "–"}</b> W</span></div>
            <div><small>Normalized</small><span><b>{st.np ?? "–"}</b> W</span></div>
            {ftp && a?.intensityFactor !== undefined && <div><small>Intensity</small><span><b>{a.intensityFactor.toFixed(2)}</b> IF</span></div>}
            {ftp && st.tss !== undefined && <div><small>Training stress</small><span><b>{st.tss}</b> TSS</span></div>}
          </div>
          {!ftp && <p class="muted small">Add your FTP in Me to see intensity, training stress and power zones.</p>}
          {st.powerCurve && Object.keys(st.powerCurve).length > 0 && <PowerCurve curve={st.powerCurve} />}
          {a?.powerZones && <ZoneBar seconds={a.powerZones} labels={POWER_ZONE_LABEL} colors={POWER_COLORS} />}
        </section>
      )}

      {watchFile}
    </>
  );
}

/** "How hard was it?" with chips 1-10; the ends and a few steps in between carry a short label. */
function EffortPrompt({ rpe, onPick, onCancel }: { rpe: number | null; onPick: (n: number) => Promise<void>; onCancel?: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <section class="stack-8">
      <h2 class="section-title">How hard was it?</h2>
      <div class="rpe-chips" role="group" aria-label="Effort from 1 to 10">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} class={rpe === n ? "rpe-chip active" : "rpe-chip"} aria-pressed={rpe === n} disabled={busy}
            onClick={async () => { setBusy(true); try { await onPick(n); } finally { setBusy(false); } }}>
            <b>{n}</b><small>{RPE_LABEL[n] ?? ""}</small>
          </button>
        ))}
      </div>
      <p class="muted small">
        With no heart-rate data, this rating gives the ride a Relative Effort score.
        {onCancel && <> <button class="link-btn" onClick={onCancel}>Cancel</button></>}
      </p>
    </section>
  );
}

/** A stacked bar of time in each zone, with minutes per zone beneath it. */
function ZoneBar({ seconds, labels, colors }: { seconds: number[]; labels: string[]; colors: string[] }) {
  const total = seconds.reduce((x, y) => x + y, 0);
  if (total <= 0) return null;
  return (
    <div class="stack-8">
      <div class="zone-bar" role="img" aria-label="Time in each zone">
        {seconds.map((s, i) => s > 0 && <span key={i} style={{ width: `${(100 * s) / total}%`, background: colors[i] }} />)}
      </div>
      <ul class="zone-list">
        {seconds.map((s, i) => (
          <li key={i}><i style={{ background: colors[i] }} /><span>{labels[i]}</span><strong>{mins(s)}</strong><span class="muted">{Math.round((100 * s) / total)}%</span></li>
        ))}
      </ul>
    </div>
  );
}

const CURVE_LABEL: Record<number, string> = { 5: "5 s", 15: "15 s", 30: "30 s", 60: "1 min", 300: "5 min", 600: "10 min", 1200: "20 min", 3600: "1 h" };

/** Best average power over 5 s to 1 h, on a log time axis. */
function PowerCurve({ curve }: { curve: Record<string, number> }) {
  const W = 320, H = 110, padL = 4, padB = 18;
  const pts = POWER_CURVE_S.filter((s) => curve[String(s)] !== undefined).map((s) => ({ s, w: curve[String(s)] }));
  if (!pts.length) return null;
  const hi = maxOf(pts.map((p) => p.w), 1);
  const lo0 = Math.log(POWER_CURVE_S[0]), span = Math.log(POWER_CURVE_S[POWER_CURVE_S.length - 1]) - lo0;
  const x = (s: number) => padL + ((Math.log(s) - lo0) / span) * (W - 2 * padL - 8);
  const y = (w: number) => 8 + (1 - w / hi) * (H - padB - 14);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.s).toFixed(1)} ${y(p.w).toFixed(1)}`).join("");
  return (
    <div class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} class="power-curve" role="img" aria-label="Power curve, best average watts by duration">
        <path d={`${d}L${x(pts[pts.length - 1].s).toFixed(1)} ${H - padB}L${x(pts[0].s).toFixed(1)} ${H - padB}Z`} fill="var(--accent)" opacity="0.15" />
        <path d={d} fill="none" stroke="var(--accent)" stroke-width="1.8" />
        {pts.map((p) => <circle key={p.s} cx={x(p.s)} cy={y(p.w)} r="2.5" fill="var(--accent)" />)}
        {[5, 60, 300, 1200, 3600].map((s) => (
          <text key={s} x={x(s)} y={H - 4} text-anchor={s === 5 ? "start" : s === 3600 ? "end" : "middle"} font-size="9" fill="var(--muted)">{CURVE_LABEL[s]}</text>
        ))}
      </svg>
      <ul class="curve-values">
        {pts.map((p) => <li key={p.s}><small>{CURVE_LABEL[p.s]}</small><b>{p.w} W</b></li>)}
      </ul>
    </div>
  );
}

/**
 * Every time you rode this trip: rides with the same saved route plus rides with the same shape (found by
 * matching the lines, so imported and unplanned rides count too). Marks the fastest and this one.
 */
export function MatchedRides({ ride, all }: { ride: RideDetail; all: Ride[] }) {
  const rows = useMemo(() => {
    const byShape = matchedRides(ride, all);
    const sameRoute = ride.routeId ? all.filter((r) => r.routeId === ride.routeId && r.id !== ride.id) : [];
    const seen = new Set<string>();
    const others = [...sameRoute, ...byShape].filter((r) => !seen.has(r.id) && !!seen.add(r.id));
    const self = { id: ride.id, riddenAt: ride.riddenAt, distanceM: ride.distanceM, timeS: ride.timeS, stats: ride.stats };
    return [self, ...others].sort((p, q) => q.riddenAt.localeCompare(p.riddenAt));
  }, [ride.id, ride.polyline, all]);
  if (rows.length < 2) return null;
  const moving = (r: { stats: { movingS: number } | null; timeS: number }) => r.stats?.movingS ?? r.timeS;
  const fastest = rows.reduce((b, r) => (moving(r) < moving(b) ? r : b), rows[0]).id;
  return (
    <section class="stack-8">
      <h2 class="section-title">Matched rides</h2>
      <ul class="tier-speeds matched-list">
        {rows.map((r) => (
          <li key={r.id} class={r.id === ride.id ? "this-ride" : ""} onClick={() => r.id !== ride.id && (rideDetail.value = { id: r.id })}>
            <span class="matched-date">{dateLabel(r.riddenAt)}{r.id === ride.id && <span class="muted"> · this ride</span>}</span>
            {r.id === fastest ? <span class="pr-badge gold">Fastest</span> : <span />}
            <strong>{duration(moving(r))}</strong>
            <span class="muted">{r.stats ? r.stats.avgKmh.toFixed(1) : ((r.distanceM / r.timeS) * 3.6 || 0).toFixed(1)} km/h</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
