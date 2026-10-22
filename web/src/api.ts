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

/** Local development only: the Worker honours this header when DEV_AUTH=1 (never in production). */
export function devEmail(): string | null {
  try {
    return localStorage.getItem("kayuh.devEmail");
  } catch {
    return null;
  }
}

export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "X-Kayuh-Device": deviceId() };
  const dev = devEmail();
  if (dev) h["X-Dev-Email"] = dev;
  return h;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
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
export interface Me {
  id: string | null; email: string | null; displayName: string | null;
  operator: "helloride" | "anywheel" | "own"; capMinutes: number; speedKmh: number; signedIn: boolean;
  /** URL of your profile picture, or null. */
  avatar: string | null;
}
export interface CrewSummary { id: string; name: string; role: "owner" | "member"; members: number; nextRide: string | null }
export interface CrewMember { id: string; name: string; operator: Me["operator"]; capMinutes: number; role: "owner" | "member"; me: boolean; avatar: string | null }
export interface GroupRideSummary {
  id: string; crewId: string; crewName?: string; title: string; startsAt: string;
  meet: { name: string; lon: number; lat: number }; distanceM: number; timeS: number; tierM: number[]; legs: number;
  going: number; myStatus: RsvpStatus | null;
}
export type RsvpStatus = "going" | "maybe" | "no";
export interface CrewDetail { id: string; name: string; role: "owner" | "member"; inviteCode: string; members: CrewMember[]; rides: GroupRideSummary[] }
export interface CrewRide { id: string; name: string; riddenAt: string; distanceM: number; timeS: number; tierM: number[]; polyline: string; rider: string; mine: boolean }
export interface CrewRoute {
  id: string; name: string; mode: SavedRoute["mode"]; profile: SavedRoute["profile"]; points: LonLat[]; prefs: Prefs;
  distanceM: number; timeS: number; tierM: number[]; legs: number; polyline: string;
  note: string | null; sharedAt: string; sharedBy: string; mine: boolean; canRemove: boolean;
}
export interface GroupRideDetail {
  id: string; crewId: string; crewName: string; title: string; startsAt: string; notes: string | null;
  meet: { name: string; lon: number; lat: number };
  route: { name: string; points: LonLat[]; prefs: Prefs; distanceM: number; timeS: number; tierM: number[]; legs: number; polyline: string };
  people: { id: string; name: string; operator: Me["operator"]; capMinutes: number; status: RsvpStatus | null; me: boolean; avatar: string | null }[];
  strictestCapMinutes: number | null;
  canDelete: boolean;
}
export interface NewGroupRide {
  title: string; startsAt: string; notes?: string; meet: { lon: number; lat: number; name: string };
  route: { name: string; profile: string; points: LonLat[]; prefs: Prefs; distanceM: number; timeS: number; tierM: number[]; legs: number; polyline: string };
}

export const api = {
  search: (q: string) => req<{ places: Place[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`).then((r) => r.places),
  conditions: ([lon, lat]: LonLat) => req<Conditions>("GET", `/api/conditions?lat=${lat}&lon=${lon}`),
  me: () => req<Me>("GET", "/api/me"),
  saveMe: (me: { operator: Me["operator"]; capMinutes: number; speedKmh: number; displayName?: string }) => req<Me>("PUT", "/api/me", me),
  setAvatar: (image: string) => req<{ avatar: string }>("PUT", "/api/me/avatar", { image }),
  removeAvatar: () => req("DELETE", "/api/me/avatar"),
  crews: () => req<{ crews: CrewSummary[] }>("GET", "/api/crews").then((r) => r.crews),
  createCrew: (name: string) => req<{ id: string; inviteCode: string }>("POST", "/api/crews", { name }),
  joinCrew: (code: string) => req<{ crewId: string; name: string }>("POST", "/api/crews/join", { code }),
  crew: (id: string) => req<CrewDetail>("GET", `/api/crews/${id}`),
  renameCrew: (id: string, name: string) => req("PATCH", `/api/crews/${id}`, { name }),
  newInvite: (id: string) => req<{ inviteCode: string }>("POST", `/api/crews/${id}/invite`),
  leaveCrew: (id: string) => req("DELETE", `/api/crews/${id}/members/me`),
  crewRides: (id: string) => req<{ rides: CrewRide[] }>("GET", `/api/crews/${id}/rides`).then((r) => r.rides),
  crewRoutes: (id: string) => req<{ routes: CrewRoute[] }>("GET", `/api/crews/${id}/routes`).then((r) => r.routes),
  shareRouteToCrew: (crewId: string, routeId: string, note?: string) => req("POST", `/api/crews/${crewId}/routes`, { routeId, note }),
  unshareCrewRoute: (crewId: string, routeId: string) => req("DELETE", `/api/crews/${crewId}/routes/${routeId}`),
  planGroupRide: (crewId: string, ride: NewGroupRide) => req<{ id: string }>("POST", `/api/crews/${crewId}/group-rides`, ride),
  groupRides: () => req<{ rides: GroupRideSummary[] }>("GET", "/api/group-rides").then((r) => r.rides),
  groupRide: (id: string) => req<GroupRideDetail>("GET", `/api/group-rides/${id}`),
  rsvp: (id: string, status: RsvpStatus) => req("PUT", `/api/group-rides/${id}/rsvp`, { status }),
  deleteGroupRide: (id: string) => req("DELETE", `/api/group-rides/${id}`),
  /** The ride as an .ics file (fetched with auth headers, then handed to the calendar). */
  groupRideIcs: async (id: string) => {
    const res = await fetch(`/api/group-rides/${id}/ics`, { headers: authHeaders() });
    if (!res.ok) throw new ApiError("Couldn't make the calendar file", res.status);
    return res.blob();
  },
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
