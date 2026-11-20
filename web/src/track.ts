/**
 * Recorded GPS tracks: what the ride screen records, how it's stored (worker/src/validate.ts checks
 * the same shape), and the analysis the ride detail page shows.
 */
import { haversine, type LonLat } from "@kayuh/router";
import { decodePolyline, encodePolyline, maxOf } from "./util.ts";

export interface Sample {
  ll: LonLat;
  /** Seconds since the ride started. */
  t: number;
  /** GPS altitude, metres (null when the phone doesn't give one). */
  alt: number | null;
  /** GPS speed, km/h (null when unknown). */
  kmh: number | null;
  /** Path type (tier 0-5) of the planned route where you were, or -1 when off it. */
  tier: number;
  /** Heart rate (bpm), cadence (rpm) and power (W) from a watch or power meter, null where there's no reading. */
  hr: number | null;
  cad: number | null;
  power: number | null;
}

/**
 * Stored form: one encoded polyline plus parallel arrays (time deltas, altitude, speed x10, tiers, leg starts).
 * v2 adds heart rate, cadence and power arrays; v1 tracks (no sensors) still decode.
 */
export interface TrackJson {
  v: 1 | 2;
  p: string;
  t: number[];
  a?: (number | null)[];
  s?: (number | null)[];
  k?: string;
  L?: number[];
  /** v2: heart rate bpm, cadence rpm, power watts per sample (whole numbers, null = no reading). */
  h?: (number | null)[];
  c?: (number | null)[];
  w?: (number | null)[];
}

/** What the rider tells us about their body (Me tab); every field is optional. */
export interface Physiology {
  birthYear?: number | null;
  maxHr?: number | null;
  restHr?: number | null;
  ftpW?: number | null;
  weightKg?: number | null;
}

/** Summary kept with every ride (lists and personal records use it without the track). */
export interface RideStats {
  movingS: number;
  elapsedS: number;
  distanceM: number;
  avgKmh: number;
  maxKmh: number;
  elevGainM?: number;
  stops: number;
  stoppedS: number;
  /** Fastest time (s) over each distance (m) within the ride. */
  bests: Partial<Record<BestKey, number>>;
  // Training numbers. Health data: the worker only ever sends these to the rider (publicStats in worker/src/validate.ts).
  avgHr?: number;
  maxHr?: number;
  /** Seconds in heart-rate zones 1-5. */
  hrZones?: number[];
  /** Relative Effort (Edwards TRIMP), or an RPE-based estimate when there's no heart rate. */
  effort?: number;
  /** Training load for the Fitness & Freshness chart: the same number as `effort` (see trainingLoad). */
  load?: number;
  avgPower?: number;
  maxPower?: number;
  /** Normalized power. */
  np?: number;
  /** Training Stress Score (needs FTP). */
  tss?: number;
  /** Best average watts over 5, 15, 30, 60, 300, 600, 1200 and 3600 s, keyed by seconds. */
  powerCurve?: Record<string, number>;
}

export const BEST_EFFORTS = [400, 1000, 5000, 10000, 20000, 40000] as const;
export type BestKey = `${(typeof BEST_EFFORTS)[number]}`;
export const BEST_LABEL: Record<BestKey, string> = { 400: "400 m", 1000: "1 km", 5000: "5 km", 10000: "10 km", 20000: "20 km", 40000: "40 km" };

const MIN_STEP_M = 4;         // ignore GPS wobble when standing still
const MAX_GAP_S = 5;          // ...but keep at least one sample this often
const MOVING_KMH = 3;         // slower than this is stopped (walking the bike counts as stopped)
const STOP_S = 30;            // a pause this long is a stop
const MAX_PLAUSIBLE_KMH = 60; // GPS jumps faster than this are noise

// ------------------------------------------------------------------ recording

export class TrackRecorder {
  samples: Sample[] = [];
  /** Sample index where each rental leg started. */
  legStarts: number[] = [0];

  constructor(private startedAt: number, from?: TrackJson | null) {
    if (from) {
      this.samples = decodeTrack(from);
      this.legStarts = from.L?.length ? from.L : [0];
    }
  }

  add(ll: LonLat, atMs: number, alt: number | null, kmh: number | null, tier: number, hr: number | null = null, cad: number | null = null, power: number | null = null) {
    const t = Math.max(0, Math.round((atMs - this.startedAt) / 1000));
    const last = this.samples.at(-1);
    if (last) {
      const d = haversine(last.ll[0], last.ll[1], ll[0], ll[1]);
      if (d < MIN_STEP_M && t - last.t < MAX_GAP_S) return;
      if (t > last.t && (d / (t - last.t)) * 3.6 > MAX_PLAUSIBLE_KMH) return;
    }
    this.samples.push({ ll, t, alt: alt === null ? null : Math.round(alt), kmh: kmh === null ? null : Math.round(kmh * 10) / 10, tier, hr, cad, power });
  }

  /** A new rental leg starts at the next sample. */
  newLeg() {
    if (this.legStarts.at(-1) !== this.samples.length) this.legStarts.push(this.samples.length);
  }

  toJSON(): TrackJson | null {
    return encodeTrack(this.samples, this.legStarts);
  }
}

/** The stored form of a track (null under two samples). Sensor arrays only appear when some sample has a reading. */
export function encodeTrack(samples: Sample[], legStarts: number[] = [0]): TrackJson | null {
  if (samples.length < 2) return null;
  const s = thin(samples, 30_000);
  let prev = 0;
  const sensor = (pick: (x: Sample) => number | null) => (s.some((x) => pick(x) !== null) ? s.map(pick) : undefined);
  const h = sensor((x) => x.hr), c = sensor((x) => x.cad), w = sensor((x) => x.power);
  const out: TrackJson = {
    v: h || c || w ? 2 : 1,
    p: encodePolyline(s.map((x) => x.ll)),
    t: s.map((x) => { const d = x.t - prev; prev = x.t; return d; }),
    a: s.some((x) => x.alt !== null) ? s.map((x) => x.alt) : undefined,
    s: s.some((x) => x.kmh !== null) ? s.map((x) => (x.kmh === null ? null : Math.round(x.kmh * 10))) : undefined,
    k: s.map((x) => (x.tier >= 0 ? String(x.tier) : "-")).join(""),
    L: legStarts.map((i) => Math.min(Math.round((i * s.length) / samples.length), s.length - 1)),
  };
  if (h) out.h = h;
  if (c) out.c = c;
  if (w) out.w = w;
  return out;
}

/** Keep at most `max` samples (very long rides), always keeping the first and last. */
function thin(s: Sample[], max: number): Sample[] {
  if (s.length <= max) return s;
  const step = s.length / max;
  const out: Sample[] = [];
  for (let i = 0; i < max - 1; i++) out.push(s[Math.floor(i * step)]);
  out.push(s[s.length - 1]);
  return out;
}

export function decodeTrack(j: TrackJson): Sample[] {
  const ll = decodePolyline(j.p);
  let t = 0;
  return ll.map((p, i) => {
    t += j.t[i] ?? 0;
    const sp = j.s?.[i];
    const k = j.k?.[i];
    return {
      ll: p, t, alt: j.a?.[i] ?? null, kmh: sp === null || sp === undefined ? null : sp / 10, tier: k && k !== "-" ? Number(k) : -1,
      hr: j.h?.[i] ?? null, cad: j.c?.[i] ?? null, power: j.w?.[i] ?? null,
    };
  });
}

// ------------------------------------------------------------------ analysis

export interface Analysis extends RideStats {
  /** Cumulative distance at each sample, metres. */
  cumM: number[];
  /** Smoothed speed at each sample, km/h. */
  speed: number[];
  /** One row per kilometre (the last may be shorter). */
  splits: { km: number; distanceM: number; movingS: number; kmh: number; elevM: number | null }[];
  /** Distance and average moving speed on each path type. */
  byTier: { tier: number; distanceM: number; kmh: number }[];
  /** Each rental leg: distance, elapsed time and average moving speed. */
  legs: { distanceM: number; elapsedS: number; movingS: number; kmh: number }[];
  /** Smoothed altitude per sample (null when the track has none). */
  elevation: (number | null)[] | null;
  /** The max heart rate the zones used, and whether it was estimated (no value set by the rider). */
  hrMax?: { bpm: number; estimated: boolean };
  /** Intensity factor (NP / FTP) and seconds in the seven Coggan power zones, when FTP is known. */
  intensityFactor?: number;
  powerZones?: number[];
}

const kmhOf = (m: number, s: number) => (s > 0 ? (m / s) * 3.6 : 0);

/** `physiology` and `rpe` (the rider's own settings and rating for this ride) only affect the training numbers. */
export function analyse(samples: Sample[], legStarts: number[] = [0], opts: { physiology?: Physiology | null; rpe?: number | null } = {}): Analysis {
  const n = samples.length;
  const cumM = new Array<number>(n).fill(0);
  const moving = new Array<boolean>(n).fill(false);
  for (let i = 1; i < n; i++) {
    const a = samples[i - 1], b = samples[i];
    const dt = b.t - a.t;
    let d = haversine(a.ll[0], a.ll[1], b.ll[0], b.ll[1]);
    // Where the phone reported its speed, a step can't be much longer than that speed allows: this removes
    // position jumps (tunnels, tall blocks) that would otherwise pad the distance and fake best efforts.
    const v = Math.max(a.kmh ?? -1, b.kmh ?? -1);
    if (v >= 0) d = Math.min(d, (v / 3.6) * dt * 1.25 + 3);
    cumM[i] = cumM[i - 1] + d;
    moving[i] = dt > 0 && dt <= 60 && kmhOf(d, dt) >= MOVING_KMH;
  }
  const distanceM = cumM[n - 1] ?? 0;
  const elapsedS = n ? samples[n - 1].t - samples[0].t : 0;

  let movingS = 0, stoppedS = 0, stops = 0, pause = 0;
  for (let i = 1; i < n; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (moving[i]) {
      movingS += dt;
      if (pause >= STOP_S) { stops++; stoppedS += pause; }
      pause = 0;
    } else pause += dt;
  }
  if (pause >= STOP_S) { stops++; stoppedS += pause; }

  // Phones measure speed from the GPS signal itself (Doppler), which is far steadier than distance between
  // fixes: use it when we have it, as a 5-sample median. Otherwise speed over ~10 s either side, never across a
  // gap in the track (a jump after a tunnel or HDB canyon would otherwise read as a sprint).
  const gpsSpeed = samples.filter((s) => s.kmh !== null).length >= n * 0.5;
  const speed = samples.map((s, i) => {
    if (gpsSpeed) {
      const w = samples.slice(Math.max(0, i - 2), i + 3).map((x) => x.kmh).filter((x): x is number => x !== null).sort((a, b) => a - b);
      if (w.length) return Math.min(MAX_PLAUSIBLE_KMH, w[Math.floor(w.length / 2)]);
    }
    let j = i, k = i;
    while (j > 0 && s.t - samples[j - 1].t <= 10 && samples[j].t - samples[j - 1].t <= 8) j--;
    while (k < n - 1 && samples[k + 1].t - s.t <= 10 && samples[k + 1].t - samples[k].t <= 8) k++;
    return Math.min(MAX_PLAUSIBLE_KMH, kmhOf(cumM[k] - cumM[j], samples[k].t - samples[j].t));
  });
  const maxKmh = maxOf(speed, 0);

  const elevation = smoothAltitude(samples);
  let elevGainM: number | undefined;
  if (elevation) {
    // Count climbs only once they pass 3 m, so GPS altitude noise doesn't add up to a mountain.
    let gain = 0, base = elevation.find((x) => x !== null) ?? 0;
    for (const e of elevation) {
      if (e === null) continue;
      if (e - base >= 3) { gain += e - base; base = e; } else if (e < base) base = e;
    }
    elevGainM = Math.round(gain);
  }

  // Splits per kilometre.
  const splits: Analysis["splits"] = [];
  let kmStart = 0, mov = 0;
  for (let i = 1; i < n; i++) {
    if (moving[i]) mov += samples[i].t - samples[i - 1].t;
    const endOfKm = cumM[i] >= (splits.length + 1) * 1000;
    if (endOfKm || i === n - 1) {
      const dist = cumM[i] - cumM[kmStart];
      if (dist < 50 && !endOfKm) break;
      const e0 = elevation?.[kmStart] ?? null, e1 = elevation?.[i] ?? null;
      splits.push({ km: splits.length + 1, distanceM: dist, movingS: mov, kmh: kmhOf(dist, mov), elevM: e0 !== null && e1 !== null ? e1 - e0 : null });
      kmStart = i;
      mov = 0;
    }
  }

  // Speed by path type, from the planned route's tier at each point.
  // Distance counts every step on the tier (so it matches the tier bar); speed uses only the moving steps.
  const tierM = [0, 0, 0, 0, 0, 0], tierMovM = [0, 0, 0, 0, 0, 0], tierS = [0, 0, 0, 0, 0, 0];
  for (let i = 1; i < n; i++) {
    const t = samples[i].tier;
    if (t < 0) continue;
    tierM[t] += cumM[i] - cumM[i - 1];
    if (!moving[i]) continue;
    tierMovM[t] += cumM[i] - cumM[i - 1];
    tierS[t] += samples[i].t - samples[i - 1].t;
  }
  const byTier = tierM.map((m, tier) => ({ tier, distanceM: m, kmh: kmhOf(tierMovM[tier], tierS[tier]) })).filter((x) => x.distanceM >= 100);

  const legs = (n ? legStarts : []).map((start, li) => {
    const from = Math.min(start, n - 1);
    const to = Math.min(li + 1 < legStarts.length ? legStarts[li + 1] : n - 1, n - 1);
    let ms = 0;
    for (let i = from + 1; i <= to; i++) if (moving[i]) ms += samples[i].t - samples[i - 1].t;
    const d = cumM[to] - cumM[from];
    return { distanceM: d, elapsedS: samples[to].t - samples[from].t, movingS: ms, kmh: kmhOf(d, ms) };
  }).filter((l) => l.distanceM > 0);

  return {
    movingS, elapsedS, distanceM, avgKmh: kmhOf(distanceM, movingS), maxKmh, elevGainM, stops, stoppedS,
    bests: bestEfforts(samples, cumM), cumM, speed, splits, byTier, legs, elevation,
    ...trainingStats(samples, movingS, opts.physiology, opts.rpe),
  };
}

/** Fastest elapsed time over each best-effort distance (two pointers over the track). */
function bestEfforts(samples: Sample[], cumM: number[]): RideStats["bests"] {
  const out: RideStats["bests"] = {};
  const total = cumM.at(-1) ?? 0;
  for (const d of BEST_EFFORTS) {
    if (total < d) break;
    let best = Infinity, j = 0;
    for (let i = 0; i < samples.length; i++) {
      while (j < samples.length && cumM[j] - cumM[i] < d) j++;
      if (j >= samples.length) break;
      // Interpolate the exact moment d metres was reached between samples j-1 and j.
      const over = cumM[j] - cumM[i] - d, segM = cumM[j] - cumM[j - 1];
      const t = samples[j].t - (segM > 0 ? (over / segM) * (samples[j].t - samples[j - 1].t) : 0);
      best = Math.min(best, t - samples[i].t);
    }
    if (Number.isFinite(best) && best > 0) out[String(d) as BestKey] = Math.round(best);
  }
  return out;
}

function smoothAltitude(samples: Sample[]): (number | null)[] | null {
  const have = samples.filter((s) => s.alt !== null).length;
  if (have < Math.max(10, samples.length * 0.5)) return null;
  return samples.map((s, i) => {
    let sum = 0, cnt = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(samples.length - 1, i + 3); k++) {
      const a = samples[k].alt;
      if (a !== null) { sum += a; cnt++; }
    }
    return cnt ? sum / cnt : null;
  });
}

/** The stored summary: the analysis minus the per-sample arrays. */
export function summary(a: Analysis): RideStats {
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    movingS: Math.round(a.movingS), elapsedS: Math.round(a.elapsedS), distanceM: Math.round(a.distanceM), avgKmh: r(a.avgKmh),
    maxKmh: r(a.maxKmh), elevGainM: a.elevGainM, stops: a.stops, stoppedS: Math.round(a.stoppedS), bests: a.bests,
    ...definedOnly({
      avgHr: a.avgHr, maxHr: a.maxHr, hrZones: a.hrZones, effort: a.effort, load: a.load,
      avgPower: a.avgPower, maxPower: a.maxPower, np: a.np, tss: a.tss, powerCurve: a.powerCurve,
    }),
  };
}

const definedOnly = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

// ------------------------------------------------------------------ training metrics

const DEFAULT_MAX_HR = 190;
/** A sensor reading holds for this long until the next one arrives; longer than that is a gap (watch paused, signal lost). */
const HOLD_S = 10;
/** Longest span (seconds) the per-second series covers: 48 h, the longest ride Kayuh stores. */
const MAX_SPAN_S = 48 * 3600 + 1;
const HR_MIN = 25, HR_MAX = 250;
const validHr = (v: number | null) => (v !== null && v >= HR_MIN && v <= HR_MAX ? v : null);
export const POWER_CURVE_S = [5, 15, 30, 60, 300, 600, 1200, 3600] as const;
export const HR_ZONE_LABEL = ["Z1 Recovery", "Z2 Endurance", "Z3 Tempo", "Z4 Threshold", "Z5 Max"];
export const POWER_ZONE_LABEL = ["Z1 Active recovery", "Z2 Endurance", "Z3 Tempo", "Z4 Threshold", "Z5 VO2 max", "Z6 Anaerobic", "Z7 Neuromuscular"];

/** The rider's max heart rate: their own value, else 208 - 0.7 x age (Tanaka), else 190. */
export function maxHrFor(p: Physiology | null | undefined, year = new Date().getFullYear()): { bpm: number; estimated: boolean } {
  if (p?.maxHr) return { bpm: p.maxHr, estimated: false };
  if (p?.birthYear && p.birthYear <= year) return { bpm: Math.round(208 - 0.7 * (year - p.birthYear)), estimated: true };
  return { bpm: DEFAULT_MAX_HR, estimated: true };
}

/** Heart-rate zone (0-4 for Z1-Z5) of a reading: Z1 under 60% of max, then 70, 80, 90 (Z5 from 90%). */
export function hrZoneOf(hr: number, maxHr: number): number {
  const f = hr / maxHr;
  return f < 0.6 ? 0 : f < 0.7 ? 1 : f < 0.8 ? 2 : f < 0.9 ? 3 : 4;
}

/** Coggan power zone (0-6 for Z1-Z7) of a reading: under 55% of FTP, then 75, 90, 105, 120, 150. */
export function powerZoneOf(watts: number, ftp: number): number {
  const f = watts / ftp;
  return f < 0.55 ? 0 : f < 0.75 ? 1 : f < 0.9 ? 2 : f < 1.05 ? 3 : f < 1.2 ? 4 : f < 1.5 ? 5 : 6;
}

/**
 * One reading per second (index = seconds since the first sample) from a sensor that logs at uneven
 * intervals: each reading holds until the next one, for at most HOLD_S. null where there's no reading.
 */
export function perSecond(samples: Sample[], pick: (s: Sample) => number | null): (number | null)[] {
  if (!samples.length) return [];
  // Never size by the raw time span: one bad timestamp would ask for billions of slots.
  const t0 = samples[0].t, len = Math.min(Math.max(0, samples[samples.length - 1].t - t0) + 1, MAX_SPAN_S);
  const out: (number | null)[] = new Array(len).fill(null);
  for (let i = 0; i < samples.length; i++) {
    const v = pick(samples[i]);
    if (v === null) continue;
    const from = samples[i].t - t0, end = i + 1 < samples.length ? samples[i + 1].t - t0 : from + 1;
    for (let s = Math.max(0, from); s < Math.min(end, from + HOLD_S, len); s++) out[s] = v;
  }
  return out;
}

export interface HrMetrics { avgHr: number; maxHr: number; hrZones: number[]; max: { bpm: number; estimated: boolean } }

/** Time in each heart-rate zone (seconds), average and highest heart rate. null when the track has no heart rate. */
export function hrMetrics(samples: Sample[], phys?: Physiology | null): HrMetrics | null {
  const series = perSecond(samples, (s) => validHr(s.hr));
  const max = maxHrFor(phys);
  const zones = [0, 0, 0, 0, 0];
  let sum = 0, n = 0;
  for (const v of series) {
    if (v === null) continue;
    zones[hrZoneOf(v, max.bpm)]++;
    sum += v;
    n++;
  }
  if (!n) return null;
  return { avgHr: Math.round(sum / n), maxHr: maxOf(samples.map((s) => validHr(s.hr) ?? 0)), hrZones: zones, max };
}

/**
 * Relative Effort: Edwards TRIMP, the minutes spent in each heart-rate zone times the zone number (1-5).
 * Without heart rate, a rating of perceived exertion stands in: 0.5 x RPE x moving minutes. null if neither.
 */
export function relativeEffort(hrZones: number[] | null | undefined, rpe: number | null | undefined, movingS: number): number | null {
  if (hrZones && hrZones.some((z) => z > 0)) return Math.round(hrZones.reduce((sum, sec, i) => sum + (sec / 60) * (i + 1), 0));
  if (rpe && rpe >= 1 && rpe <= 10 && movingS > 0) return Math.round(0.5 * rpe * (movingS / 60));
  return null;
}

/**
 * Training load of one ride, the input to a Fitness & Freshness (CTL/ATL/TSB) chart. It is Relative Effort for
 * every ride, whatever sensors it had: heart-rate rides and RPE-only rides then share one scale, and so do
 * rides with and without a power meter. (TSS is kept as its own number; it is not mixed into the load.)
 */
export const trainingLoad = (effort: number | null): number | null => effort;

export interface PowerMetrics {
  avgPower: number; maxPower: number; np: number;
  /** Seconds with a power reading. */
  seconds: number;
  powerCurve: Record<string, number>;
  /** With FTP: intensity factor, Training Stress Score and seconds in the seven Coggan zones. */
  intensityFactor?: number; tss?: number; zones?: number[];
}

/** Average, max and normalized power; with FTP also IF, TSS and zones. Always the power curve. null without power. */
export function powerMetrics(samples: Sample[], ftpW?: number | null): PowerMetrics | null {
  const series = perSecond(samples, (s) => s.power);
  const have = series.filter((v): v is number => v !== null);
  if (!have.length) return null;
  const seconds = have.length;
  const avg = have.reduce((a, b) => a + b, 0) / seconds;

  // Prefix sums over the per-second series, so any window's mean is cheap. A window counts only if it has a
  // reading in every second: a pause in the middle of an effort doesn't join the two halves.
  const sum = new Float64Array(series.length + 1), cnt = new Uint32Array(series.length + 1);
  series.forEach((v, i) => { sum[i + 1] = sum[i] + (v ?? 0); cnt[i + 1] = cnt[i] + (v === null ? 0 : 1); });
  const best = (d: number) => {
    let b = -1;
    for (let i = 0; i + d <= series.length; i++) if (cnt[i + d] - cnt[i] === d) b = Math.max(b, (sum[i + d] - sum[i]) / d);
    return b;
  };

  // Normalized power: 30 s rolling average, 4th power, mean, 4th root.
  let p4 = 0, wins = 0;
  for (let i = 0; i + 30 <= series.length; i++) {
    if (cnt[i + 30] - cnt[i] !== 30) continue;
    p4 += ((sum[i + 30] - sum[i]) / 30) ** 4;
    wins++;
  }
  const np = wins ? (p4 / wins) ** 0.25 : avg;

  const powerCurve: Record<string, number> = {};
  for (const d of POWER_CURVE_S) {
    const b = best(d);
    if (b >= 0) powerCurve[String(d)] = Math.round(b);
  }
  const out: PowerMetrics = { avgPower: Math.round(avg), maxPower: Math.min(4000, maxOf(samples.map((s) => s.power ?? 0))), np: Math.round(np), seconds, powerCurve };
  if (ftpW && ftpW > 0) {
    out.intensityFactor = Math.round((np / ftpW) * 100) / 100;
    out.tss = Math.round(((seconds * np * (np / ftpW)) / (ftpW * 3600)) * 100);
    out.zones = [0, 0, 0, 0, 0, 0, 0];
    for (const v of have) out.zones[powerZoneOf(v, ftpW)]++;
  }
  return out;
}

/** All the training numbers for a ride, shaped to merge into Analysis. Empty when there is no heart rate, power or RPE. */
function trainingStats(samples: Sample[], movingS: number, phys: Physiology | null | undefined, rpe: number | null | undefined): Partial<Analysis> {
  const hr = hrMetrics(samples, phys), pw = powerMetrics(samples, phys?.ftpW);
  const effort = relativeEffort(hr?.hrZones, rpe, movingS);
  const load = trainingLoad(effort);
  return definedOnly({
    avgHr: hr?.avgHr, maxHr: hr?.maxHr, hrZones: hr?.hrZones, hrMax: hr?.max,
    effort: effort ?? undefined, load: load ?? undefined,
    avgPower: pw?.avgPower, maxPower: pw?.maxPower, np: pw?.np, tss: pw?.tss, powerCurve: pw?.powerCurve,
    intensityFactor: pw?.intensityFactor, powerZones: pw?.zones,
  });
}

/** Colour for a speed on the map and charts: slow amber → green → fast blue. */
export function speedColor(kmh: number): string {
  if (kmh < 8) return "#D9541E";
  if (kmh < 12) return "#E3A21A";
  if (kmh < 16) return "#6DB98A";
  if (kmh < 20) return "#17804F";
  if (kmh < 25) return "#1E8C9E";
  return "#2E6BD1";
}

export const SPEED_LEGEND: [string, string][] = [
  ["#D9541E", "<8"], ["#E3A21A", "8–12"], ["#6DB98A", "12–16"], ["#17804F", "16–20"], ["#1E8C9E", "20–25"], ["#2E6BD1", "25+"],
];
