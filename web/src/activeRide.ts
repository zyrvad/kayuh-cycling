/**
 * The ride in progress, kept in local storage so it survives the app being closed or reloaded.
 *
 * Starting a ride also reloads the page when anything was typed since the app opened. On iPhone,
 * "Shake to Undo" offers to undo the last typing whenever the phone is shaken, and a bike shakes
 * it constantly. Typing history belongs to the page, so a reload is the only way to clear it.
 */
import type { LonLat, RouteResult } from "@kayuh/router";
import type { TrackJson } from "./track.ts";

const KEY = "kayuh.activeRide";
/** A ride left open longer than this is treated as abandoned. */
const STALE_MS = 14 * 3600_000;

export interface ActiveRide {
  route: RouteResult;
  name: string;
  routeId: string | null;
  /** Free minutes per ride for this ride (null = own bike), the group's strictest if it's a group ride. */
  capMinutes: number | null;
  startedAt: number;
  legIndex: number;
  legStart: number;
  /** Legs ridden before the last re-route, so leg numbers keep counting up. */
  legsDone: number;
  /** Where the ride still has to go: unvisited stops, then the destination. */
  targets: LonLat[];
  track: TrackJson | null;
  savedAt: number;
}

export function loadActiveRide(): ActiveRide | null {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? "null") as ActiveRide | null;
    if (!a || Date.now() - a.savedAt > STALE_MS || !a.route?.coords?.length) return null;
    return a;
  } catch {
    return null;
  }
}

export function saveActiveRide(a: Omit<ActiveRide, "savedAt">) {
  try {
    // The graph steps are only needed for planning, and they're most of the size.
    localStorage.setItem(KEY, JSON.stringify({ ...a, route: { ...a.route, steps: [] }, savedAt: Date.now() }));
  } catch { /* storage full or unavailable: the ride still works, it just won't survive a restart */ }
}

export function clearActiveRide() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

let typed = false;
document.addEventListener("input", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) typed = true;
}, true);

/** True when a reload is needed to clear iPhone's shake-to-undo history before riding. */
export const needsUndoReset = () => typed && /iPhone|iPad|iPod/.test(navigator.userAgent);
