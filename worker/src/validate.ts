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
  const at = str(o, "riddenAt", 40);
  if (Number.isNaN(Date.parse(at))) throw new BadRequest("riddenAt: expected an ISO date");
  // Stored as ISO UTC so sorting the text sorts by time (the feed's paging relies on it).
  const riddenAt = new Date(at).toISOString();
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
    track: o.track === undefined || o.track === null ? null : track(o.track),
    stats: o.stats === undefined || o.stats === null ? null : rideStats(o.stats),
    rpe: o.rpe === undefined || o.rpe === null ? null : rpeValue(o.rpe),
  };
}

/** Rating of perceived exertion: a whole number 1-10. */
function rpeValue(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 10) throw new BadRequest("rpe: expected a whole number from 1 to 10");
  return v;
}

export function effortBody(v: unknown): number | null {
  const o = obj(v);
  return o.rpe === undefined || o.rpe === null ? null : rpeValue(o.rpe);
}

const MAX_SAMPLES = 30_000; // ~8 hours at one fix a second
const ints = (v: unknown, k: string, max: number, nullable = false, lim = 1e7) => {
  if (!Array.isArray(v) || v.length > max || !v.every((x) => (nullable && x === null) || (Number.isInteger(x) && Math.abs(x as number) < lim))) {
    throw new BadRequest(`track.${k}: expected up to ${max} integers`);
  }
  return v as (number | null)[];
};

/** The GPS track of a recorded ride (see web/src/track.ts). Stored as given, after checking its shape and size. */
function track(v: unknown): string {
  const o = obj(v);
  if (o.v !== 1 && o.v !== 2) throw new BadRequest("track.v: expected 1 or 2");
  if (typeof o.p !== "string" || o.p.length > MAX_POLYLINE * 2) throw new BadRequest("track.p: expected an encoded polyline");
  const out: Obj = { v: o.v, p: o.p, t: ints(o.t, "t", MAX_SAMPLES) };
  if (o.a !== undefined) out.a = ints(o.a, "a", MAX_SAMPLES, true);
  if (o.s !== undefined) out.s = ints(o.s, "s", MAX_SAMPLES, true);
  // v2: heart rate (bpm), cadence (rpm) and power (W) per sample, whole numbers 0-3000, null where there's no reading.
  if (o.v === 2) {
    for (const k of ["h", "c", "w"] as const) {
      if (o[k] === undefined) continue;
      const arr = ints(o[k], k, MAX_SAMPLES, true, 3001);
      if (arr.some((x) => x !== null && x < 0)) throw new BadRequest(`track.${k}: expected integers from 0 to 3000`);
      out[k] = arr;
    }
  }
  if (o.k !== undefined) {
    if (typeof o.k !== "string" || o.k.length > MAX_SAMPLES || !/^[0-5-]*$/.test(o.k)) throw new BadRequest("track.k: expected path types");
    out.k = o.k;
  }
  if (o.L !== undefined) out.L = ints(o.L, "L", 400);
  return JSON.stringify(out);
}

const STAT_KEYS = ["movingS", "elapsedS", "distanceM", "avgKmh", "maxKmh", "elevGainM", "stops", "stoppedS"] as const;
const BEST_KEYS = ["400", "1000", "5000", "10000", "20000", "40000"];

/** Training numbers (bounds are generous: they only stop junk). Owner-only: see HEALTH_STAT_KEYS. */
const TRAINING_STATS: Record<string, [number, number]> = {
  avgHr: [0, 260], maxHr: [0, 260], effort: [0, 5000], load: [0, 5000], avgPower: [0, 3000], maxPower: [0, 4000], np: [0, 3000], tss: [0, 2000],
};
export const POWER_CURVE_SECONDS = ["5", "15", "30", "60", "300", "600", "1200", "3600"];
/** Everything in a ride's stats that is health data, which only the rider may see. */
export const HEALTH_STAT_KEYS = [...Object.keys(TRAINING_STATS), "hrZones", "powerCurve"] as const;

/**
 * The ride's stats as anyone but its owner may see them: no heart rate, effort, load or power.
 * Every response that can reach another person must pass stats through this.
 */
export function publicStats<T extends Record<string, unknown> | null | undefined>(stats: T): T {
  if (!stats) return stats;
  const out: Record<string, unknown> = { ...stats };
  for (const k of HEALTH_STAT_KEYS) delete out[k];
  return out as T;
}

/** The ride summary: a handful of numbers plus best efforts (metres → seconds). */
function rideStats(v: unknown): string {
  const o = obj(v);
  const out: Obj = {};
  for (const k of STAT_KEYS) {
    if (o[k] === undefined || o[k] === null) continue;
    out[k] = num(o, k, 0, 1_000_000);
  }
  if (o.bests !== undefined) {
    const b = obj(o.bests);
    const bests: Obj = {};
    for (const k of BEST_KEYS) if (b[k] !== undefined) bests[k] = num(b, k, 1, 100_000);
    out.bests = bests;
  }
  for (const [k, [lo, hi]] of Object.entries(TRAINING_STATS)) {
    if (o[k] === undefined || o[k] === null) continue;
    out[k] = num(o, k, lo, hi);
  }
  if (o.hrZones !== undefined && o.hrZones !== null) {
    const z = o.hrZones;
    if (!Array.isArray(z) || z.length !== 5 || !z.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1_000_000)) {
      throw new BadRequest("hrZones: expected 5 non-negative numbers");
    }
    out.hrZones = z;
  }
  if (o.powerCurve !== undefined && o.powerCurve !== null) {
    const c = obj(o.powerCurve);
    const curve: Obj = {};
    for (const k of POWER_CURVE_SECONDS) if (c[k] !== undefined) curve[k] = num(c, k, 0, 4000);
    out.powerCurve = curve;
  }
  return JSON.stringify(out);
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

/** An optional whole-number setting: absent keeps what's saved (undefined), null clears it. */
function optionalInt(o: Obj, k: string, min: number, max: number): number | null | undefined {
  if (o[k] === undefined) return undefined;
  if (o[k] === null) return null;
  const v = num(o, k, min, max);
  if (!Number.isInteger(v)) throw new BadRequest(`${k}: expected a whole number`);
  return v;
}

export function meBody(v: unknown) {
  const o = obj(v);
  const weight = o.weightKg === undefined || o.weightKg === null ? o.weightKg : Math.round(num(o, "weightKg", 30, 200) * 10) / 10;
  return {
    birthYear: optionalInt(o, "birthYear", 1920, new Date().getUTCFullYear()),
    maxHr: optionalInt(o, "maxHr", 120, 230),
    restHr: optionalInt(o, "restHr", 30, 100),
    ftpW: optionalInt(o, "ftpW", 50, 600),
    weightKg: weight as number | null | undefined,
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

// ------------------------------------------------------------------ social

export const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

/** Who a ride is shared with: some of your crews, and/or your followers. */
export function sharingBody(v: unknown) {
  const o = obj(v);
  const ids = o.crewIds;
  if (!Array.isArray(ids) || ids.length > 20 || !ids.every(isId)) throw new BadRequest("crewIds: expected up to 20 crew ids");
  if (typeof o.followers !== "boolean") throw new BadRequest("followers: expected true or false");
  return { crewIds: [...new Set(ids.map((s) => s.toLowerCase()))], followers: o.followers };
}

/** Follow someone by their follow-link code, or (for a crewmate) by their id. */
export function followBody(v: unknown): { code: string } | { userId: string } {
  const o = obj(v);
  if (o.userId !== undefined) {
    if (!isId(o.userId)) throw new BadRequest("userId: expected a user id");
    return { userId: o.userId.toLowerCase() };
  }
  const code = str(o, "code", 20).toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(code)) throw new BadRequest("code: expected a follow code");
  return { code };
}

export function privateAccountBody(v: unknown) {
  const p = obj(v).privateAccount;
  if (typeof p !== "boolean") throw new BadRequest("privateAccount: expected true or false");
  return p;
}

export function commentBody(v: unknown) {
  const b = obj(v).body;
  const t = typeof b === "string" ? b.trim() : "";
  if (!t || t.length > 500) throw new BadRequest("body: expected 1-500 characters");
  return t;
}

/** Feed paging: `before` is the `next` value of the previous page (an ISO date, optionally "|<ride id>"). */
export function feedQuery(before: string | undefined, limit: string | undefined) {
  let at: string | null = null, id = "";
  if (before) {
    const [a, b = ""] = before.split("|");
    if (a.length > 40 || Number.isNaN(Date.parse(a)) || (b && !ID.test(b))) throw new BadRequest("before: expected a date from the previous page");
    at = new Date(a).toISOString();
    id = b.toLowerCase();
  }
  const n = limit === undefined ? 20 : Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new BadRequest("limit: expected 1-50");
  return { at, id, limit: n };
}
