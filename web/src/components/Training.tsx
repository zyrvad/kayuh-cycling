import { useEffect, useMemo, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { api, type Ride } from "../api.ts";
import {
  dayDate, fitnessSeries, goalProgress, ridesWithLoad, sgDay, weekLog, type DayLog, type Goal, type GoalMetric, type GoalPeriod,
  type WeekLog,
} from "../fitness.ts";
import { me, openRide, refreshMe, showToast } from "../state.ts";
import { duration, km } from "../util.ts";
import { Close, Plus } from "./Icons.tsx";
import "./training.css";

/** Which half of the Rides tab is showing. A signal so it survives opening a ride and coming back. */
export const trainingOn = signal(false);

const shortDate = (day: number) => dayDate(day).toLocaleDateString("en-SG", { day: "numeric", month: "short", timeZone: "UTC" });
const PERIOD_LABEL: Record<GoalPeriod, string> = { week: "this week", month: "this month", year: "this year" };
const METRIC_LABEL: Record<GoalMetric, string> = { distance: "Distance", time: "Time", rides: "Rides" };
const METRIC_UNIT: Record<GoalMetric, string> = { distance: "km", time: "hours", rides: "rides" };
const BOUNDS: Record<GoalMetric, [number, number]> = { distance: [1, 100_000], time: [1, 5_000], rides: [1, 2_000] };

export function Training() {
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.rides().then(setRides).catch((e) => setError(e.message)); }, []);
  return (
    <>
      {error && <div class="banner warn">{error}</div>}
      {rides && (
        <>
          <Goals rides={rides} />
          <FitnessChart rides={rides} />
          <TrainingLog rides={rides} />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ goals

function Goals({ rides }: { rides: Ride[] }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const signedIn = me.value?.signedIn;
  const today = sgDay(Date.now());
  const reload = () => api.goals().then(setGoals).catch((e) => { setGoals([]); showToast(e.message); });
  useEffect(() => { if (!me.value) refreshMe(); }, []);
  useEffect(() => { if (signedIn) reload(); }, [signedIn]);

  return (
    <section class="stack-8">
      <div class="row between">
        <h2 class="section-title">Goals</h2>
        {signedIn && <button class="pill-btn" onClick={() => setEditing("new")}><Plus size={14} /> Add</button>}
      </div>
      {signedIn === false && <div class="banner info">Sign in from the Crew tab to set distance, time or ride goals.</div>}
      {signedIn && goals?.length === 0 && (
        <p class="muted">No goals yet. A good first one: 100 km a month, or 3 rides a week. <button class="link-btn" onClick={() => setEditing("new")}>Set a goal</button></p>
      )}
      <div class="goal-grid">
        {goals?.map((g) => {
          const p = goalProgress(g, rides, today);
          return (
            <button key={g.id} class="goal-card" aria-label={`Edit ${g.metric} goal ${PERIOD_LABEL[g.period]}`} onClick={() => setEditing(g)}>
              <Ring fraction={p.fraction} />
              <span class="goal-text">
                <b>{amount(g.metric, p.value)} of {amount(g.metric, g.target)}</b>
                <small class="muted">{unitLabel(g.metric, g.target)} {PERIOD_LABEL[g.period]}</small>
              </span>
            </button>
          );
        })}
      </div>
      {editing && (
        <GoalSheet goal={editing === "new" ? null : editing} taken={goals ?? []} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }} />
      )}
    </section>
  );
}

const amount = (m: GoalMetric, v: number) => (m === "distance" ? (v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "")) : m === "time" ? v.toFixed(1).replace(/\.0$/, "") : String(Math.round(v)));
const unitLabel = (m: GoalMetric, target: number) => (m === "rides" ? (target === 1 ? "ride" : "rides") : m === "time" ? "hours" : "km");

function Ring({ fraction }: { fraction: number }) {
  const r = 20, c = 2 * Math.PI * r;
  return (
    <svg class="ring" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r={r} class="ring-bg" />
      <circle cx="24" cy="24" r={r} class="ring-fg" stroke-dasharray={`${c * fraction} ${c}`} transform="rotate(-90 24 24)" />
      <text x="24" y="28" text-anchor="middle" class="ring-pct">{Math.round(fraction * 100)}%</text>
    </svg>
  );
}

function GoalSheet({ goal, taken, onClose, onSaved }: { goal: Goal | null; taken: Goal[]; onClose: () => void; onSaved: () => void }) {
  const [period, setPeriod] = useState<GoalPeriod>(goal?.period ?? "month");
  const [metric, setMetric] = useState<GoalMetric>(goal?.metric ?? "distance");
  const [target, setTarget] = useState(goal ? String(goal.target) : "");
  const [busy, setBusy] = useState(false);
  const [lo, hi] = BOUNDS[metric];
  const value = Number(target);
  const valid = target.trim() !== "" && Number.isFinite(value) && value >= lo && value <= hi;
  // Saving over another goal with the same period and metric replaces its target.
  const replaces = !goal && taken.some((g) => g.period === period && g.metric === metric);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); showToast(done); onSaved(); } catch (e) { showToast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div class="sheet-full" role="dialog" aria-label={goal ? "Edit goal" : "New goal"}>
      <div class="search-head">
        <strong class="lg grow" style={{ alignSelf: "center" }}>{goal ? "Edit goal" : "New goal"}</strong>
        <button class="icon-btn" aria-label="Close" onClick={onClose}><Close /></button>
      </div>
      <div class="form-body">
        <Segments label="Period" value={period} disabled={!!goal} options={["week", "month", "year"] as GoalPeriod[]}
          text={(p) => p[0].toUpperCase() + p.slice(1)} onChange={setPeriod} />
        <Segments label="Measure" value={metric} disabled={!!goal} options={["distance", "time", "rides"] as GoalMetric[]}
          text={(m) => METRIC_LABEL[m]} onChange={setMetric} />
        <label class="field">
          Target ({METRIC_UNIT[metric]} per {period})
          <input type="number" inputMode="decimal" min={lo} max={hi} step="any" value={target}
            onInput={(e) => setTarget((e.target as HTMLInputElement).value)} />
          <small class="muted">{lo.toLocaleString()} to {hi.toLocaleString()}</small>
        </label>
        {replaces && <p class="muted small">You already have this goal. Saving changes its target.</p>}
        <button class="btn primary" disabled={!valid || busy}
          onClick={() => run(() => api.setGoal({ period, metric, target: value }), "Goal saved")}>{busy ? "Saving…" : "Save"}</button>
        {goal && <button class="btn outline danger" disabled={busy} onClick={() => run(() => api.deleteGoal(goal.id), "Goal deleted")}>Delete goal</button>}
      </div>
    </div>
  );
}

function Segments<T extends string>({ label, value, options, text, onChange, disabled }: {
  label: string; value: T; options: T[]; text: (o: T) => string; onChange: (o: T) => void; disabled?: boolean;
}) {
  return (
    <div class="stack-8">
      <span class="section-title">{label}</span>
      <div class="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o} class={value === o ? "seg active" : "seg"} aria-pressed={value === o} disabled={disabled && value !== o}
            onClick={() => onChange(o)}>{text(o)}</button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ fitness & freshness

const RANGES = [{ days: 90, label: "90 days" }, { days: 180, label: "6 months" }, { days: 365, label: "1 year" }];
const W = 340, H = 140, PAD = 8;

function FitnessChart({ rides }: { rides: Ride[] }) {
  const [days, setDays] = useState(90);
  const [cursor, setCursor] = useState<number | null>(null);
  const today = sgDay(Date.now());
  const enough = ridesWithLoad(rides) >= 3;
  const series = useMemo(() => fitnessSeries(rides, today - days + 1, today), [rides, days, today]);

  return (
    <section class="stack-8">
      <h2 class="section-title">Fitness &amp; Freshness</h2>
      {!enough ? (
        <p class="muted">Not enough data yet. This chart needs at least 3 rides with an effort number. Import a watch file (GPX, TCX or FIT with heart rate) on a ride, or open a ride and rate how hard it felt.</p>
      ) : (
        <FitnessLines series={series} days={days} setDays={setDays} cursor={cursor} setCursor={setCursor} />
      )}
    </section>
  );
}

function FitnessLines({ series, days, setDays, cursor, setCursor }: {
  series: ReturnType<typeof fitnessSeries>; days: number; setDays: (d: number) => void; cursor: number | null; setCursor: (i: number | null) => void;
}) {
  const vals = series.flatMap((p) => [p.fitness, p.fatigue, p.form]);
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
  const x = (i: number) => (series.length > 1 ? (i / (series.length - 1)) * W : 0);
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
  const line = (f: (p: (typeof series)[number]) => number) => series.map((p, i) => `${x(i).toFixed(1)},${y(f(p)).toFixed(1)}`).join(" ");
  const shown = series[cursor ?? series.length - 1];
  const pick = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    setCursor(Math.max(0, Math.min(series.length - 1, Math.round(((e.clientX - r.left) / r.width) * (series.length - 1)))));
  };
  if (!shown) return null;
  return (
    <>
      <div class="segmented" role="group" aria-label="Chart range">
        {RANGES.map((r) => (
          <button key={r.days} class={days === r.days ? "seg active" : "seg"} aria-pressed={days === r.days} onClick={() => { setDays(r.days); setCursor(null); }}>{r.label}</button>
        ))}
      </div>
      <div class="chart">
        <div class="chart-readout fit-readout">
          <span class="muted">{cursor === null ? "Today" : shortDate(shown.day)}</span>
          <span class="fit-key fitness">Fitness <b>{Math.round(shown.fitness)}</b></span>
          <span class="fit-key fatigue">Fatigue <b>{Math.round(shown.fatigue)}</b></span>
          <span class="fit-key form">Form <b>{Math.round(shown.form)}</b></span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} class="fit-svg" role="img" aria-label="Fitness, Fatigue and Form over time"
          onPointerDown={pick} onPointerMove={(e) => e.buttons || e.pointerType === "touch" ? pick(e) : undefined} onPointerLeave={() => setCursor(null)}>
          {lo < 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} class="fit-zero" />}
          <polyline points={line((p) => p.fatigue)} class="fit-line fatigue" />
          <polyline points={line((p) => p.fitness)} class="fit-line fitness" />
          <polyline points={line((p) => p.form)} class="fit-line form" />
          {days <= 90 && series.map((p, i) => p.rides && <circle key={p.day} cx={x(i)} cy={y(p.fitness)} r="2.6" class="fit-dot" />)}
          {cursor !== null && <line x1={x(cursor)} x2={x(cursor)} y1="0" y2={H} class="fit-cursor" />}
        </svg>
        <div class="chart-axis"><span>{shortDate(series[0].day)}</span><span>{shortDate(series[series.length - 1].day)}</span></div>
      </div>
      <p class="muted">
        <b>Fitness</b> is your average effort over the last 6 weeks: it rises slowly when you ride regularly. <b>Fatigue</b> is the last week only, so it jumps after hard rides and fades fast.
        {" "}<b>Form</b> is Fitness minus Fatigue: below zero you're carrying tiredness, above zero you're fresh. Dots mark days you rode.
      </p>
    </>
  );
}

// ------------------------------------------------------------------ training log

function TrainingLog({ rides }: { rides: Ride[] }) {
  const [metric, setMetric] = useState<"time" | "distance">("time");
  const [open, setOpen] = useState<DayLog<Ride> | null>(null);
  const today = sgDay(Date.now());
  const weeks = useMemo(() => weekLog(rides, today, 12), [rides, today]);
  const size = (d: DayLog<Ride>) => (metric === "time" ? d.movingS : d.distanceM);
  const max = Math.max(1, ...weeks.flatMap((w) => w.days.map(size)));
  const tap = (d: DayLog<Ride>) => {
    if (d.rides.length === 1) openRide(d.rides[0].id);
    else if (d.rides.length > 1) setOpen(open?.day === d.day ? null : d);
  };
  return (
    <section class="stack-8">
      <div class="row between">
        <h2 class="section-title">Training log</h2>
        <div class="segmented tlog-toggle" role="group" aria-label="Circle size">
          <button class={metric === "time" ? "seg active" : "seg"} aria-pressed={metric === "time"} onClick={() => setMetric("time")}>Time</button>
          <button class={metric === "distance" ? "seg active" : "seg"} aria-pressed={metric === "distance"} onClick={() => setMetric("distance")}>Distance</button>
        </div>
      </div>
      <div class="tlog">
        <div class="tlog-row tlog-head" aria-hidden="true">
          <span />{["M", "T", "W", "T", "F", "S", "S"].map((l, i) => <span key={i}>{l}</span>)}<span />
        </div>
        {[...weeks].reverse().map((w) => (
          <div key={w.start} class="tlog-row">
            <span class="tlog-week">{shortDate(w.start)}</span>
            {w.days.map((d) => <DayDot key={d.day} d={d} size={size(d)} max={max} today={today} onTap={() => tap(d)} />)}
            <WeekTotals w={w} />
          </div>
        ))}
      </div>
      {open && (
        <div class="stack-8 tlog-day">
          <strong>{dayDate(open.day).toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}</strong>
          <ul class="list">
            {open.rides.map((r) => (
              <li key={r.id}>
                <button class="list-card tlog-ride" onClick={() => openRide(r.id)}>
                  <span class="list-main"><strong>{r.name}</strong><span class="muted">{km(r.distanceM)} km · {duration(r.stats?.movingS ?? r.timeS)}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DayDot({ d, size, max, today, onTap }: { d: DayLog<Ride>; size: number; max: number; today: number; onTap: () => void }) {
  const dia = size > 0 ? 8 + Math.sqrt(size / max) * 22 : 0;
  const label = `${shortDate(d.day)}: ${d.rides.length ? `${d.rides.length} ride${d.rides.length === 1 ? "" : "s"}, ${km(d.distanceM)} km, ${duration(d.movingS)}` : "no rides"}`;
  return (
    <button class={d.day === today ? "tlog-day-cell today" : "tlog-day-cell"} disabled={!d.rides.length} aria-label={label} onClick={onTap}>
      {d.rides.length > 0 && <span class="tlog-dot" style={{ width: `${dia}px`, height: `${dia}px` }} />}
    </button>
  );
}

function WeekTotals({ w }: { w: WeekLog<Ride> }) {
  return (
    <span class="tlog-total">
      <b>{w.rides ? `${km(w.distanceM)} km` : "–"}</b>
      <small class="muted">{w.rides ? duration(w.movingS) : ""}</small>
    </span>
  );
}
