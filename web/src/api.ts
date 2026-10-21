/** Client for the Kayuh Worker API (worker/src/index.ts). */
import type { LonLat, Prefs } from "@kayuh/router";

const DEVICE_KEY = "kayuh.device";

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // Private mode without storage: a per-session id still works.
    return (deviceId as any).fallback ??= crypto.randomUUID();
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Kayuh-Device": deviceId() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status);
  return json as T;
}

export interface Place { name: string; address: string; postal: string; lat: number; lon: number }
export interface Conditions {
  forecast: { area: string; text: string; validUntil: string; rainLikely: boolean } | null;
  tempC: { value: number; station: string } | null;
  heat: { wbgt: number; level: string; station: string } | null;
}
export interface SavedRoute {
  id: string; name: string; mode: "ab" | "loop" | "explore" | "freeform"; profile: "nicest" | "balanced" | "direct";
  points: LonLat[]; prefs: Prefs; distanceM: number; timeS: number; tierM: number[]; legs: number;
  polyline: string; shareToken: string | null; updatedAt: string;
}
export type NewRoute = Omit<SavedRoute, "id" | "shareToken" | "updatedAt">;
export interface Ride {
  id: string; routeId: string | null; name: string; riddenAt: string; distanceM: number; timeS: number;
  tierM: number[]; polyline: string; source: "planned" | "recorded" | "gpx"; visibility: "private" | "crew";
  /** Kayuh's base-model estimate for the part actually ridden, for pace learning. */
  predictedS: number | null;
}
export interface Me { operator: "helloride" | "anywheel" | "own"; capMinutes: number; speedKmh: number; signedIn: boolean }

export const api = {
  search: (q: string) => req<{ places: Place[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`).then((r) => r.places),
  conditions: ([lon, lat]: LonLat) => req<Conditions>("GET", `/api/conditions?lat=${lat}&lon=${lon}`),
  me: () => req<Me>("GET", "/api/me"),
  saveMe: (me: Omit<Me, "signedIn">) => req<Me>("PUT", "/api/me", me),
  routes: () => req<{ routes: SavedRoute[] }>("GET", "/api/routes").then((r) => r.routes),
  saveRoute: (r: NewRoute) => req<{ id: string }>("POST", "/api/routes", r),
  deleteRoute: (id: string) => req("DELETE", `/api/routes/${id}`),
  shareRoute: (id: string) => req<{ token: string }>("POST", `/api/routes/${id}/share`),
  shared: (token: string) => req<{ route: SavedRoute }>("GET", `/api/share/${token}`).then((r) => r.route),
  rides: () => req<{ rides: Ride[] }>("GET", "/api/rides").then((r) => r.rides),
  logRide: (r: Omit<Ride, "id" | "visibility" | "routeId" | "predictedS"> & { routeId?: string | null; predictedS?: number | null }) => req<{ id: string }>("POST", "/api/rides", r),
  setRideVisibility: (id: string, visibility: Ride["visibility"]) => req("PATCH", `/api/rides/${id}`, { visibility }),
  deleteRide: (id: string) => req("DELETE", `/api/rides/${id}`),
};
