/** Free ride (no destination): pure state helpers and persistence. No DOM except localStorage in load/save. */
import { haversine, type LonLat } from "@kayuh/router";
import type { TrackJson } from "./track.ts";

export const KEY = "kayuh.freeRide";
/** GPS steps shorter than this are jitter. */
export const MIN_STEP_M = 3;
/** Fixes less accurate than this (metres) are ignored. */
export const MAX_ACCURACY_M = 30;
/** Shorter than this is not worth saving. */
export const MIN_SAVE_M = 100;
const STALE_MS = 14 * 3600_000;

export interface FreeRideState {
  startedAt: number;
  /** Total time spent paused before `pausedAt`, ms. */
  pausedMs: number;
  /** When the current pause began (null when riding). */
  pausedAt: number | null;
  distanceM: number;
  last: LonLat | null;
  track: TrackJson | null;
  /** Free minutes per ride (null = own bike). */
  capMinutes: number | null;
  savedAt: number;
}

export const newFreeRide = (now: number, capMinutes: number | null): FreeRideState => ({
  startedAt: now, pausedMs: 0, pausedAt: null, distanceM: 0, last: null, track: null, capMinutes, savedAt: now,
});

/** Add a GPS fix to the running distance. Returns the new distance and whether the fix counted. */
export function addFix(distanceM: number, last: LonLat | null, ll: LonLat, accuracyM: number | null): { distanceM: number; last: LonLat | null; counted: boolean } {
  if (accuracyM !== null && accuracyM > MAX_ACCURACY_M) return { distanceM, last, counted: false };
  if (!last) return { distanceM, last: ll, counted: true };
  const d = haversine(last[0], last[1], ll[0], ll[1]);
  if (d < MIN_STEP_M) return { distanceM, last, counted: false };
  return { distanceM: distanceM + d, last: ll, counted: true };
}

/** Elapsed seconds excluding time spent paused. */
export function movingSeconds(s: Pick<FreeRideState, "startedAt" | "pausedMs" | "pausedAt">, now: number): number {
  const paused = s.pausedMs + (s.pausedAt !== null ? Math.max(0, now - s.pausedAt) : 0);
  return Math.max(0, (now - s.startedAt - paused) / 1000);
}

export const pause = <T extends FreeRideState>(s: T, now: number): T => (s.pausedAt === null ? { ...s, pausedAt: now } : s);
export const resume = <T extends FreeRideState>(s: T, now: number): T =>
  s.pausedAt === null ? s : { ...s, pausedMs: s.pausedMs + Math.max(0, now - s.pausedAt), pausedAt: null };

/** Seconds of the rental's free time left (the timer runs on riding time); null for your own bike. */
export function freeSecondsLeft(capMinutes: number | null, riddenS: number): number | null {
  return capMinutes === null ? null : capMinutes * 60 - riddenS;
}

/** The last 5 minutes (and overtime) warn. */
export const isWarn = (left: number | null) => left !== null && left <= 300;

export const tooShort = (distanceM: number) => distanceM < MIN_SAVE_M;

export function rideName(d: Date): string {
  const h = d.getHours();
  return `${h < 5 ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 21 ? "Evening" : "Night"} ride`;
}

export function loadFreeRide(now = Date.now()): FreeRideState | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as FreeRideState | null;
    if (!s || typeof s.startedAt !== "number" || now - s.savedAt > STALE_MS) return null;
    return s;
  } catch { return null; }
}
export function saveFreeRide(s: FreeRideState) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...s, savedAt: Date.now() })); } catch { /* ignore */ }
}
export function clearFreeRide() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
