/** Request body validation. Small and explicit rather than a schema library. */

export class BadRequest extends Error {}

/** The request's JSON body, or a 400 if it isn't JSON. */
export async function jsonBody(req: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadRequest("expected a JSON body");
  }
}

const MODES = ["ab", "loop", "explore", "freeform"] as const;
const PROFILES = ["nicest", "balanced", "direct"] as const;
const OPERATORS = ["helloride", "anywheel", "own"] as const;
const RATINGS = ["great", "avoid", "closed"] as const;
const VISIBILITY = ["private", "crew"] as const;
// Singapore, with margin.
const BBOX = { minLon: 103.55, maxLon: 104.15, minLat: 1.13, maxLat: 1.5 };
const MAX_POLYLINE = 200_000;

type Obj = Record<string, unknown>;

export function obj(v: unknown): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BadRequest("expected a JSON object");
  return v as Obj;
}

export function str(o: Obj, k: string, max = 120, optional = false): string {
  const v = o[k];
  if ((v === undefined || v === null) && optional) return "";
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new BadRequest(`${k}: expected a string of at most ${max} chars`);
  return v.trim();
}

export function num(o: Obj, k: string, min: number, max: number): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new BadRequest(`${k}: expected a number in [${min}, ${max}]`);
  return v;
}

export function oneOf<T extends string>(o: Obj, k: string, allowed: readonly T[]): T {
  const v = o[k];
  if (typeof v !== "string" || !allowed.includes(v as T)) throw new BadRequest(`${k}: expected one of ${allowed.join(", ")}`);
  return v as T;
}

export function inSingapore(lon: number, lat: number): boolean {
  return lon >= BBOX.minLon && lon <= BBOX.maxLon && lat >= BBOX.minLat && lat <= BBOX.maxLat;
}

function points(o: Obj, k: string): [number, number][] {
  const v = o[k];
  if (!Array.isArray(v) || v.length < 1 || v.length > 30) throw new BadRequest(`${k}: expected 1-30 points`);
  return v.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((x) => typeof x === "number") || !inSingapore(p[0], p[1])) {
      throw new BadRequest(`${k}[${i}]: expected [lon, lat] in Singapore`);
    }
    return [p[0], p[1]] as [number, number];
  });
}

function tierM(o: Obj): number[] {
  const v = o.tierM;
  if (!Array.isArray(v) || v.length !== 6 || !v.every((x) => typeof x === "number" && x >= 0)) {
    throw new BadRequest("tierM: expected 6 non-negative numbers");
  }
  return v;
}

function polyline(o: Obj): string {
  const v = o.polyline;
  if (typeof v !== "string" || !v || v.length > MAX_POLYLINE) throw new BadRequest("polyline: expected an encoded polyline");
  return v;
}

function prefs(o: Obj): Obj {
  const p = obj(o.prefs);
  return {
    speedKmh: num(p, "speedKmh", 5, 30),
    footpathAversion: num(p, "footpathAversion", 0, 1),
    crossingAversion: num(p, "crossingAversion", 0, 1),
  };
}

export function routeBody(v: unknown) {
  const o = obj(v);
  return {
    name: str(o, "name", 80),
    mode: oneOf(o, "mode", MODES),
    profile: oneOf(o, "profile", PROFILES),
    points: points(o, "points"),
    prefs: prefs(o),
    distanceM: num(o, "distanceM", 0, 500_000),
    timeS: num(o, "timeS", 0, 100_000),
    tierM: tierM(o),
    legs: num(o, "legs", 1, 100),
    polyline: polyline(o),
  };
}

export function rideBody(v: unknown) {
  const o = obj(v);
  const riddenAt = str(o, "riddenAt", 40);
  if (Number.isNaN(Date.parse(riddenAt))) throw new BadRequest("riddenAt: expected an ISO date");
  return {
    name: str(o, "name", 80),
    routeId: str(o, "routeId", 40, true) || null,
    riddenAt,
    distanceM: num(o, "distanceM", 0, 500_000),
    timeS: num(o, "timeS", 0, 100_000),
    tierM: tierM(o),
    polyline: polyline(o),
    source: oneOf(o, "source", ["planned", "recorded", "gpx"] as const),
    predictedS: o.predictedS === undefined || o.predictedS === null ? null : num(o, "predictedS", 0, 100_000),
    // Rides are private unless the rider explicitly shares them.
    visibility: o.visibility === undefined ? "private" : oneOf(o, "visibility", VISIBILITY),
  };
}

export function visibilityBody(v: unknown) {
  return oneOf(obj(v), "visibility", VISIBILITY);
}

export function feedbackBody(v: unknown) {
  const o = obj(v);
  const lon = num(o, "lon", BBOX.minLon, BBOX.maxLon);
  const lat = num(o, "lat", BBOX.minLat, BBOX.maxLat);
  const rating = oneOf(o, "rating", RATINGS);
  const days = o.expiresInDays === undefined ? (rating === "closed" ? 14 : null) : num(o, "expiresInDays", 1, 365);
  return { lon, lat, rating, note: str(o, "note", 280, true) || null, expiresInDays: days };
}

export function meBody(v: unknown) {
  const o = obj(v);
  return {
    operator: oneOf(o, "operator", OPERATORS),
    capMinutes: num(o, "capMinutes", 10, 240),
    speedKmh: num(o, "speedKmh", 5, 30),
    displayName: str(o, "displayName", 40, true) || null,
  };
}

export function crewNameBody(v: unknown) {
  return str(obj(v), "name", 40);
}

export function joinBody(v: unknown) {
  const code = str(obj(v), "code", 20).toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(code)) throw new BadRequest("code: expected an invite code");
  return code;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function crewRouteBody(v: unknown) {
  const o = obj(v);
  const routeId = str(o, "routeId", 40);
  if (!ID.test(routeId)) throw new BadRequest("routeId: expected a route id");
  return { routeId, note: str(o, "note", 200, true) || null };
}

export function rsvpBody(v: unknown) {
  return oneOf(obj(v), "status", ["going", "maybe", "no"] as const);
}

export function groupRideBody(v: unknown) {
  const o = obj(v);
  const startsAt = str(o, "startsAt", 40);
  if (Number.isNaN(Date.parse(startsAt))) throw new BadRequest("startsAt: expected an ISO date and time");
  const meet = obj(o.meet);
  const route = routeBody({ ...obj(o.route), mode: "ab", profile: obj(o.route).profile ?? "nicest" });
  return {
    title: str(o, "title", 80),
    startsAt,
    notes: str(o, "notes", 500, true) || null,
    meet: {
      lon: num(meet, "lon", BBOX.minLon, BBOX.maxLon),
      lat: num(meet, "lat", BBOX.minLat, BBOX.maxLat),
      name: str(meet, "name", 120),
    },
    route,
  };
}

const AVATAR_MAX_BYTES = 200_000;
const MAGIC: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46], // "RIFF"
};

/** A data: URL holding a small image. The bytes must really be that image type, not HTML in disguise. */
export function avatarBody(v: unknown) {
  const image = obj(v).image;
  const m = typeof image === "string" && image.length < AVATAR_MAX_BYTES * 1.4
    ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image) : null;
  if (!m) throw new BadRequest("image: expected a JPEG, PNG or WebP data URL under 200 KB");
  const [, mime, data] = m;
  let head: string;
  try { head = atob(data.slice(0, 16)); } catch { throw new BadRequest("image: bad base64"); }
  if (!MAGIC[mime].every((b, i) => head.charCodeAt(i) === b)) throw new BadRequest("image: not a valid " + mime.slice(6));
  if (mime === "image/webp" && head.slice(8, 12) !== "WEBP") throw new BadRequest("image: not a valid webp");
  return { mime, data };
}
