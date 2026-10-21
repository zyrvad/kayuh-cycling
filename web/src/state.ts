import { computed, effect, signal } from "@preact/signals";
import type { LonLat, Prefs, RouteResult } from "@kayuh/router";
import { api, type Conditions, type Me } from "./api.ts";
import { router } from "./routerClient.ts";

// ------------------------------------------------------------------ settings

export interface Settings {
  operator: Me["operator"];
  capMinutes: number;
  speedKmh: number;
  footpathAversion: number;
  crossingAversion: number;
}

const SETTINGS_KEY = "kayuh.settings";
const DEFAULTS: Settings = { operator: "helloride", capMinutes: 30, speedKmh: 15, footpathAversion: 0.5, crossingAversion: 0.5 };

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export const settings = signal<Settings>(loadSettings());
effect(() => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value));
  } catch { /* storage unavailable: settings last for this session */ }
});

export function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  const s = settings.value;
  if ("operator" in patch || "capMinutes" in patch || "speedKmh" in patch) {
    api.saveMe({ operator: s.operator, capMinutes: s.capMinutes, speedKmh: s.speedKmh }).catch(() => {});
  }
}

export const prefs = computed<Prefs>(() => ({
  speedKmh: settings.value.speedKmh,
  footpathAversion: settings.value.footpathAversion,
  crossingAversion: settings.value.crossingAversion,
}));

/** The per-ride limit, or null for your own bike. */
export const cap = computed(() => (settings.value.operator === "own" ? null : settings.value.capMinutes));

// ------------------------------------------------------------------ navigation

export type Screen = "discover" | "plan" | "ride" | "routes" | "rides" | "crew" | "me";
export const screen = signal<Screen>("discover");
export const toast = signal<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(msg: string) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 3500);
}

// ------------------------------------------------------------------ planning

export type Mode = "ab" | "loop" | "freeform";
export interface PlanPoint { ll: LonLat; label: string }

export const mode = signal<Mode>("ab");
/** Start, stops..., end. For a loop only the first is used. */
export const points = signal<(PlanPoint | null)[]>([null, null]);
export const loopKm = signal(12);
export const results = signal<RouteResult[]>([]);
export const selected = signal(0);
export const planning = signal(false);
export const planError = signal<string | null>(null);
export const current = computed<RouteResult | null>(() => results.value[selected.value] ?? null);
/** Index of the point the next map tap will set, if any. */
export const pickIndex = signal<number | null>(null);
/** Name of a shared route when the app was opened from a share link. */
export const sharedName = signal<string | null>(null);
export const savedRouteId = signal<string | null>(null);

export const myLocation = signal<LonLat | null>(null);
export const conditions = signal<Conditions | null>(null);
export const routerInfo = signal<{ nodes: number; built: string } | null>(null);

export function setPoint(i: number, p: PlanPoint | null) {
  const next = points.value.slice();
  next[i] = p;
  points.value = next;
  savedRouteId.value = null;
  // If we were waiting for a map tap for this point, move on to the next empty one (if any).
  if (pickIndex.value === i && p) {
    const empty = next.findIndex((x) => !x);
    pickIndex.value = empty >= 0 ? empty : null;
  }
}

export function addStop() {
  const next = points.value.slice();
  next.splice(next.length - 1, 0, null);
  points.value = next;
  pickIndex.value = next.length - 2;
}

export function removePoint(i: number) {
  const next = points.value.slice();
  if (next.length <= 2) next[i] = null;
  else next.splice(i, 1);
  points.value = next;
  savedRouteId.value = null;
}

export function reverseRoute() {
  points.value = points.value.slice().reverse();
}

export function routeName(): string {
  if (sharedName.value) return sharedName.value;
  const p = points.value;
  if (mode.value === "loop") return `${loopKm.value} km loop from ${p[0]?.label ?? "start"}`;
  return `${p[0]?.label ?? "Start"} → ${p[p.length - 1]?.label ?? "End"}`;
}

let planSeq = 0;
effect(() => {
  const m = mode.value;
  const pts = points.value;
  const km = loopKm.value;
  const pr = prefs.value;
  const capMin = cap.value;
  const seq = ++planSeq;
  const ready = m === "loop" ? !!pts[0] : pts.every(Boolean) && pts.length >= 2;
  if (!ready) {
    results.value = [];
    planError.value = null;
    return;
  }
  planning.value = true;
  planError.value = null;
  const job = m === "loop"
    ? router.loops({ start: pts[0]!.ll, targetKm: km, prefs: pr, capMinutes: capMin })
    : router.plan({ points: pts.map((p) => p!.ll), prefs: pr, capMinutes: capMin });
  job.then((routes) => {
    if (seq !== planSeq) return;
    results.value = routes;
    selected.value = 0;
    if (!routes.length) planError.value = "No route found. Try moving a point closer to a path.";
  }).catch((e: Error) => {
    if (seq !== planSeq) return;
    results.value = [];
    planError.value = e.message;
  }).finally(() => {
    if (seq === planSeq) planning.value = false;
  });
});

// ------------------------------------------------------------------ location & conditions

export function locate(): Promise<LonLat | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll: LonLat = [pos.coords.longitude, pos.coords.latitude];
        myLocation.value = ll;
        resolve(ll);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

let conditionsFor = "";
export function refreshConditions(ll: LonLat) {
  const key = `${ll[0].toFixed(2)},${ll[1].toFixed(2)}`;
  if (key === conditionsFor) return;
  conditionsFor = key;
  api.conditions(ll).then((c) => (conditions.value = c)).catch(() => {});
}
