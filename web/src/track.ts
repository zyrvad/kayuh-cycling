/**
 * Recorded GPS tracks: what the ride screen records, how it's stored (worker/src/validate.ts checks
 * the same shape), and the analysis the ride detail page shows.
 */
import { haversine, type LonLat } from "@kayuh/router";
import { decodePolyline, encodePolyline } from "./util.ts";

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
}

/** Stored form: one encoded polyline plus parallel arrays (time deltas, altitude, speed x10, tiers, leg starts). */
export interface TrackJson {
  v: 1;
  p: string;
  t: number[];
  a?: (number | null)[];
  s?: (number | null)[];
  k?: string;
  L?: number[];
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

  add(ll: LonLat, atMs: number, alt: number | null, kmh: number | null, tier: number) {
    const t = Math.max(0, Math.round((atMs - this.startedAt) / 1000));
    const last = this.samples.at(-1);
    if (last) {
      const d = haversine(last.ll[0], last.ll[1], ll[0], ll[1]);
      if (d < MIN_STEP_M && t - last.t < MAX_GAP_S) return;
      if (t > last.t && (d / (t - last.t)) * 3.6 > MAX_PLAUSIBLE_KMH) return;
    }
    this.samples.push({ ll, t, alt: alt === null ? null : Math.round(alt), kmh: kmh === null ? null : Math.round(kmh * 10) / 10, tier });
  }

  /** A new rental leg starts at the next sample. */
  newLeg() {
    if (this.legStarts.at(-1) !== this.samples.length) this.legStarts.push(this.samples.length);
  }

  toJSON(): TrackJson | null {
    if (this.samples.length < 2) return null;
    const s = thin(this.samples, 30_000);
    let prev = 0;
    return {
      v: 1,
      p: encodePolyline(s.map((x) => x.ll)),
      t: s.map((x) => { const d = x.t - prev; prev = x.t; return d; }),
      a: s.some((x) => x.alt !== null) ? s.map((x) => x.alt) : undefined,
      s: s.some((x) => x.kmh !== null) ? s.map((x) => (x.kmh === null ? null : Math.round(x.kmh * 10))) : undefined,
      k: s.map((x) => (x.tier >= 0 ? String(x.tier) : "-")).join(""),
      L: this.legStarts.map((i) => Math.min(Math.round((i * s.length) / this.samples.length), s.length - 1)),
    };
  }
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
    return { ll: p, t, alt: j.a?.[i] ?? null, kmh: sp === null || sp === undefined ? null : sp / 10, tier: k && k !== "-" ? Number(k) : -1 };
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
}

const kmhOf = (m: number, s: number) => (s > 0 ? (m / s) * 3.6 : 0);

export function analyse(samples: Sample[], legStarts: number[] = [0]): Analysis {
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
  const maxKmh = speed.length ? Math.max(...speed) : 0;

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
  const tierM = [0, 0, 0, 0, 0, 0], tierS = [0, 0, 0, 0, 0, 0];
  for (let i = 1; i < n; i++) {
    const t = samples[i].tier;
    if (t < 0 || !moving[i]) continue;
    tierM[t] += cumM[i] - cumM[i - 1];
    tierS[t] += samples[i].t - samples[i - 1].t;
  }
  const byTier = tierM.map((m, tier) => ({ tier, distanceM: m, kmh: kmhOf(m, tierS[tier]) })).filter((x) => x.distanceM >= 100);

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
  };
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
