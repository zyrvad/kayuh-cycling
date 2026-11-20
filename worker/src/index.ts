import { Hono, type Context, type Next } from "hono";
import { accessEnforced, requestEmail, type AuthEnv } from "./auth.ts";
import { getConditions } from "./conditions.ts";
import { AVATAR_AT, avatarUrl, registerAvatars } from "./avatars.ts";
import { registerCrews } from "./crews.ts";
import { registerRideData } from "./rideData.ts";
import { registerHrUpload } from "./hrUpload.ts";
import { registerGoals } from "./goals.ts";
import { searchPlaces } from "./search.ts";
import { trimEnds } from "./polyline.ts";
import {
  deleteRideStatements, person, PERSON_COLUMNS, registerSocial, shareStatements, SOCIAL_COUNTS, viewer, VISIBLE_RIDES,
} from "./social.ts";
import {
  BadRequest, effortBody, feedbackBody, inSingapore, jsonBody, meBody, publicStats, rideBody, routeBody, visibilityBody,
} from "./validate.ts";

export interface Env extends AuthEnv {
  DB: D1Database;
  ASSETS?: Fetcher;
  ONEMAP_TOKEN?: string;
}

export type App = { Bindings: Env; Variables: { userId: string; account: boolean; email: string | null } };
export type Ctx = Context<App>;

const DEVICE_HEADER = "X-Kayuh-Device";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const app = new Hono<App>();

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});

// Cross-site request forgery: sign-in is a cookie, so a hostile page could make a signed-in
// browser send requests. Writes must come from our own origin and be JSON, which a plain HTML
// form or no-preflight fetch from another site cannot send.
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
app.use("/api/*", async (c, next) => {
  if (UNSAFE.has(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Cross-site request blocked" }, 403);
    if (!(c.req.header("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
      return c.json({ error: "Expected application/json" }, 415);
    }
  }
  await next();
});

const body = (c: Ctx) => jsonBody(c.req);

export function shareToken(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// ------------------------------------------------------------------ public

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ places: [] });
  if (q.length > 80) throw new BadRequest("q: too long");
  try {
    const places = await searchPlaces(q, c.env.ONEMAP_TOKEN);
    return c.json({ places }, 200, { "Cache-Control": "public, max-age=86400" });
  } catch (e) {
    console.error(e);
    return c.json({ error: "Place search is unavailable right now" }, 502);
  }
});

app.get("/api/conditions", async (c) => {
  const lat = Number(c.req.query("lat")), lon = Number(c.req.query("lon"));
  if (!inSingapore(lon, lat)) throw new BadRequest("lat/lon: expected a point in Singapore");
  const conditions = await getConditions(lat, lon);
  return c.json(conditions, 200, { "Cache-Control": "public, max-age=300" });
});

app.get("/api/share/:token", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT name, mode, profile, points, prefs, distance_m, time_s, tier_m, legs, polyline, created_at
       FROM routes WHERE share_token = ?`,
  ).bind(c.req.param("token")).first<Record<string, string | number>>();
  if (!row) return c.json({ error: "This shared route no longer exists" }, 404);
  return c.json({ route: routeOut(row) });
});

// ------------------------------------------------------------------ identity

/**
 * Signed-in people (Cloudflare Access) get an account keyed by email. Anyone else is a device:
 * the app sends a random id it keeps in local storage. When a device signs in, whatever it saved
 * before moves to the account.
 */
async function identify(c: Ctx, next: Next) {
  const db = c.env.DB;
  const email = await requestEmail(c.req.raw, c.env);
  const raw = c.req.header(DEVICE_HEADER) ?? "";
  const device = UUID.test(raw) ? raw.toLowerCase() : null;
  if (email) {
    let user = await db.prepare("SELECT id FROM users WHERE email = ? AND kind = 'account'").bind(email).first<{ id: string }>();
    if (!user) {
      const id = crypto.randomUUID();
      // Start from the device's settings, if it had any. No display name until they choose one:
      // the email's name part isn't something to show strangers.
      await db.prepare(
        `INSERT INTO users (id, kind, email, display_name, operator, cap_minutes, speed_kmh)
         SELECT ?, 'account', ?, NULL, COALESCE(d.operator, 'helloride'), COALESCE(d.cap_minutes, 30), COALESCE(d.speed_kmh, 13)
           FROM (SELECT 1) LEFT JOIN users d ON d.id = ? AND d.kind = 'device'`,
      ).bind(id, email, device).run();
      user = { id };
    }
    if (device) await mergeDevice(db, device, user.id);
    c.set("userId", user.id);
    c.set("account", true);
    c.set("email", email);
  } else if (accessEnforced(c.env)) {
    // Fail closed: behind Access, a request without a valid Access identity never reaches user data,
    // even if it somehow got past Access (e.g. the policy was switched off by mistake).
    return c.json({ error: "Sign in required", signIn: true }, 401);
  } else if (device) {
    await db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").bind(device).run();
    c.set("userId", device);
    c.set("account", false);
    c.set("email", null);
  } else {
    return c.json({ error: `missing or invalid ${DEVICE_HEADER}` }, 401);
  }
  await next();
}

async function mergeDevice(db: D1Database, device: string, account: string) {
  const d = await db.prepare("SELECT id FROM users WHERE id = ? AND kind = 'device'").bind(device).first();
  if (!d) return;
  await db.batch([
    db.prepare("UPDATE routes SET user_id = ? WHERE user_id = ?").bind(account, device),
    db.prepare("UPDATE rides SET user_id = ? WHERE user_id = ?").bind(account, device),
    db.prepare("UPDATE segment_feedback SET user_id = ? WHERE user_id = ?").bind(account, device),
    // Body settings move over only where the account has none of its own.
    ...["birth_year", "max_hr", "rest_hr", "ftp_w", "weight_kg"].map((col) =>
      db.prepare(`UPDATE users SET ${col} = (SELECT ${col} FROM users WHERE id = ?) WHERE id = ? AND ${col} IS NULL`).bind(device, account)),
    db.prepare("DELETE FROM users WHERE id = ?").bind(device),
  ]);
}

/** The only API routes anyone may call without an identity. Everything else fails closed. */
const PUBLIC_API = [/^\/api\/health$/, /^\/api\/search$/, /^\/api\/conditions$/, /^\/api\/share\/[^/]+$/,
  // Heart rate from an iOS Shortcut: no identity, authorised only by the one-ride token in the path.
  /^\/api\/hr\/[^/]+$/];

/**
 * Routes that need a real account, not just a device id: friends can't find, invite or follow
 * a device. Crews, group rides, the feed, follows, kudos, comments and per-ride sharing.
 */
const ACCOUNT_API = [
  /^\/api\/(crews|group-rides)(\/|$)/, /^\/api\/crew-rides$/, /^\/api\/feed$/, /^\/api\/(follow|following|followers|comments)(\/|$)/,
  /^\/api\/me\/follow(\/|$)/, /^\/api\/rides\/[^/]+\/(sharing|kudos|comments)$/, /^\/api\/goals(\/|$)/,
];

app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (PUBLIC_API.some((re) => re.test(path))) return next();
  let known = false;
  const refused = await identify(c, async () => { known = true; });
  if (!known) return refused;
  if (!c.var.account && ACCOUNT_API.some((re) => re.test(path))) return c.json({ error: "Sign in to ride with friends", signIn: true }, 401);
  await next();
});

const PHYSIOLOGY = "birth_year, max_hr, rest_hr, ftp_w, weight_kg";
type Physiology = { birth_year: number | null; max_hr: number | null; rest_hr: number | null; ftp_w: number | null; weight_kg: number | null };
const physiologyOut = (u: Physiology) => ({ birthYear: u.birth_year, maxHr: u.max_hr, restHr: u.rest_hr, ftpW: u.ftp_w, weightKg: u.weight_kg });

app.get("/api/me", async (c) => {
  const u = await c.env.DB.prepare(`SELECT operator, cap_minutes, speed_kmh, display_name, ${PHYSIOLOGY}, ${AVATAR_AT("users")} FROM users WHERE id = ?`)
    .bind(c.var.userId).first<{ operator: string; cap_minutes: number; speed_kmh: number; display_name: string | null; avatar_at: string | null } & Physiology>();
  return c.json({
    id: c.var.account ? c.var.userId : null, email: c.var.email, displayName: u!.display_name, avatar: avatarUrl(c.var.userId, u!.avatar_at),
    operator: u!.operator, capMinutes: u!.cap_minutes, speedKmh: u!.speed_kmh, signedIn: c.var.account, ...physiologyOut(u!),
  });
});

app.put("/api/me", async (c) => {
  const b = meBody(await body(c));
  // Physiology: a field left out keeps its saved value; null clears it (older app versions send neither).
  const keep = (v: unknown) => (v === undefined ? 0 : 1);
  await c.env.DB.prepare(
    `UPDATE users SET operator = ?, cap_minutes = ?, speed_kmh = ?, display_name = COALESCE(?, display_name),
       birth_year = CASE WHEN ? THEN ? ELSE birth_year END, max_hr = CASE WHEN ? THEN ? ELSE max_hr END,
       rest_hr = CASE WHEN ? THEN ? ELSE rest_hr END, ftp_w = CASE WHEN ? THEN ? ELSE ftp_w END,
       weight_kg = CASE WHEN ? THEN ? ELSE weight_kg END
     WHERE id = ?`,
  ).bind(b.operator, b.capMinutes, b.speedKmh, b.displayName,
    keep(b.birthYear), b.birthYear ?? null, keep(b.maxHr), b.maxHr ?? null, keep(b.restHr), b.restHr ?? null,
    keep(b.ftpW), b.ftpW ?? null, keep(b.weightKg), b.weightKg ?? null, c.var.userId).run();
  const u = await c.env.DB.prepare(`SELECT ${PHYSIOLOGY} FROM users WHERE id = ?`).bind(c.var.userId).first<Physiology>();
  return c.json({ operator: b.operator, capMinutes: b.capMinutes, speedKmh: b.speedKmh, displayName: b.displayName, ...physiologyOut(u!) });
});

registerCrews(app);
registerAvatars(app);
registerRideData(app);
registerHrUpload(app);
registerSocial(app);
registerGoals(app);

function routeOut(r: Record<string, string | number>) {
  return {
    id: r.id, name: r.name, mode: r.mode, profile: r.profile,
    points: JSON.parse(r.points as string), prefs: JSON.parse(r.prefs as string),
    distanceM: r.distance_m, timeS: r.time_s, tierM: JSON.parse(r.tier_m as string), legs: r.legs,
    polyline: r.polyline, shareToken: r.share_token ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

app.get("/api/routes", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM routes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200",
  ).bind(c.var.userId).all<Record<string, string | number>>();
  return c.json({ routes: results.map(routeOut) });
});

app.post("/api/routes", async (c) => {
  const b = routeBody(await body(c));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO routes (id, user_id, name, mode, profile, points, prefs, distance_m, time_s, tier_m, legs, polyline)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, c.var.userId, b.name, b.mode, b.profile, JSON.stringify(b.points), JSON.stringify(b.prefs),
    b.distanceM, b.timeS, JSON.stringify(b.tierM), b.legs, b.polyline).run();
  return c.json({ id }, 201);
});

async function ownedRoute(c: Ctx) {
  return c.env.DB.prepare("SELECT * FROM routes WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.var.userId).first<Record<string, string | number>>();
}

app.get("/api/routes/:id", async (c) => {
  const r = await ownedRoute(c);
  return r ? c.json({ route: routeOut(r) }) : c.json({ error: "not found" }, 404);
});

app.patch("/api/routes/:id", async (c) => {
  const name = (await body(c)) as { name?: unknown };
  if (typeof name.name !== "string" || !name.name.trim() || name.name.length > 80) throw new BadRequest("name: expected a string");
  const res = await c.env.DB.prepare("UPDATE routes SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .bind(name.name.trim(), c.req.param("id"), c.var.userId).run();
  return res.meta.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

app.delete("/api/routes/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  // Remove crew shares explicitly too (don't rely on cascades) so a deleted route vanishes everywhere.
  const [, res] = await db.batch([
    db.prepare("DELETE FROM crew_routes WHERE route_id = (SELECT id FROM routes WHERE id = ? AND user_id = ?)").bind(id, c.var.userId),
    db.prepare("DELETE FROM routes WHERE id = ? AND user_id = ?").bind(id, c.var.userId),
  ]);
  return res.meta.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

app.post("/api/routes/:id/share", async (c) => {
  const r = await ownedRoute(c);
  if (!r) return c.json({ error: "not found" }, 404);
  const token = (r.share_token as string) || shareToken();
  await c.env.DB.prepare("UPDATE routes SET share_token = ? WHERE id = ?").bind(token, r.id).run();
  return c.json({ token });
});

app.delete("/api/routes/:id/share", async (c) => {
  await c.env.DB.prepare("UPDATE routes SET share_token = NULL WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.var.userId).run();
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ rides

function rideOut(r: Record<string, string | number>) {
  return {
    id: r.id, routeId: r.route_id ?? null, name: r.name, riddenAt: r.ridden_at, distanceM: r.distance_m,
    timeS: r.time_s, tierM: JSON.parse(r.tier_m as string), polyline: r.polyline, source: r.source, visibility: r.visibility,
    predictedS: r.predicted_s ?? null, stats: r.stats ? JSON.parse(r.stats as string) : null, hasTrack: !!r.has_track, rpe: r.rpe ?? null,
    sharedCrewIds: JSON.parse(r.shared_crews as string) as string[], shareFollowers: !!r.share_followers,
  };
}

// Lists leave the (large) GPS track out; the detail endpoint sends it.
const RIDE_LIST_COLUMNS = `r.id, r.route_id, r.name, r.ridden_at, r.distance_m, r.time_s, r.tier_m, r.polyline, r.source, r.visibility,
  r.predicted_s, r.stats, r.rpe, r.track IS NOT NULL AS has_track, r.share_followers,
  (SELECT json_group_array(crew_id) FROM ride_shares WHERE ride_id = r.id) AS shared_crews`;

app.get("/api/rides", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${RIDE_LIST_COLUMNS} FROM rides r WHERE r.user_id = ? ORDER BY r.ridden_at DESC LIMIT 500`)
    .bind(c.var.userId).all<Record<string, string | number>>();
  return c.json({ rides: results.map(rideOut) });
});

/**
 * One ride. The rider gets everything, GPS track included. Anyone else who can see it (crew or
 * follower sharing, see social.ts) gets the trimmed line and stats, never the track, and nothing
 * about who else it's shared with. Everyone else gets the same 404 as a ride that doesn't exist.
 */
app.get("/api/rides/:id", async (c) => {
  const me = c.var.userId;
  const r = await c.env.DB.prepare(
    `SELECT ${RIDE_LIST_COLUMNS}, r.user_id, ${PERSON_COLUMNS}, ${SOCIAL_COUNTS} FROM rides r JOIN users u ON u.id = r.user_id
      WHERE r.id = ? AND r.id IN (${VISIBLE_RIDES})`,
  ).bind(me, c.req.param("id"), ...viewer(me)).first<Record<string, string | number>>();
  if (!r) return c.json({ error: "not found" }, 404);
  const social = { rider: person(r), kudos: Number(r.kudos), kudoed: !!r.kudoed, comments: Number(r.comment_count) };
  if (r.user_id === me) {
    const t = await c.env.DB.prepare("SELECT track FROM rides WHERE id = ?").bind(r.id).first<{ track: string | null }>();
    return c.json({ ride: { ...rideOut(r), ...social, mine: true, track: t?.track ? JSON.parse(t.track) : null } });
  }
  // Leave out anything about how it was recorded or who else sees it.
  // Heart rate, effort and power are health data: the rider only.
  const { sharedCrewIds: _c, shareFollowers: _f, source: _s, visibility: _v, predictedS: _p, routeId: _r, rpe: _e, ...out } = rideOut(r);
  return c.json({ ride: { ...out, stats: publicStats(out.stats), ...social, mine: false, hasTrack: false, polyline: trimEnds(r.polyline as string) } });
});

app.post("/api/rides", async (c) => {
  const b = rideBody(await body(c));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO rides (id, user_id, route_id, name, ridden_at, distance_m, time_s, tier_m, polyline, source, visibility, predicted_s, track, stats, rpe)
     VALUES (?, ?, (SELECT id FROM routes WHERE id = ? AND user_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, c.var.userId, b.routeId, c.var.userId, b.name, b.riddenAt, b.distanceM, b.timeS, JSON.stringify(b.tierM),
    b.polyline, b.source, "private", b.predictedS, b.track, b.stats, b.rpe).run();
  // "crew" at save time means every crew you're in, as before per-crew sharing.
  if (b.visibility === "crew") await c.env.DB.batch(shareStatements(c.env.DB, id, c.var.userId, "all", null));
  return c.json({ id }, 201);
});

// How hard the ride felt, 1-10 (null clears it). Owner only, like all training data.
app.put("/api/rides/:id/effort", async (c) => {
  const rpe = effortBody(await body(c));
  const res = await c.env.DB.prepare("UPDATE rides SET rpe = ? WHERE id = ? AND user_id = ?").bind(rpe, c.req.param("id"), c.var.userId).run();
  return res.meta.changes ? c.json({ rpe }) : c.json({ error: "not found" }, 404);
});

// The old all-or-nothing switch (kept for older app versions): "crew" shares with every crew you're
// in, "private" un-shares from crews and followers. Per-crew choice is PUT /api/rides/:id/sharing.
app.patch("/api/rides/:id", async (c) => {
  const visibility = visibilityBody(await body(c));
  const id = c.req.param("id"), me = c.var.userId;
  const owned = await c.env.DB.prepare("SELECT id FROM rides WHERE id = ? AND user_id = ?").bind(id, me).first();
  if (!owned) return c.json({ error: "not found" }, 404);
  const db = c.env.DB;
  await db.batch(visibility === "crew"
    // Recorded as asked even with no crews yet: visibility is only a label, access comes from ride_shares.
    ? [...shareStatements(db, id, me, "all", null), db.prepare("UPDATE rides SET visibility = 'crew' WHERE id = ? AND user_id = ?").bind(id, me)]
    : shareStatements(db, id, me, [], false));
  return c.json({ ok: true });
});

app.delete("/api/rides/:id", async (c) => {
  const res = await c.env.DB.batch(deleteRideStatements(c.env.DB, c.req.param("id"), c.var.userId));
  return res[res.length - 1].meta.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

// ------------------------------------------------------------------ segment feedback

app.get("/api/feedback", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, rating, lon, lat, note, expires_at FROM segment_feedback
      WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
  ).bind(c.var.userId).all();
  return c.json({ feedback: results });
});

app.post("/api/feedback", async (c) => {
  const b = feedbackBody(await body(c));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO segment_feedback (id, user_id, rating, lon, lat, note, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', '+' || ? || ' days') END)`,
  ).bind(id, c.var.userId, b.rating, b.lon, b.lat, b.note, b.expiresInDays, b.expiresInDays).run();
  return c.json({ id }, 201);
});

app.delete("/api/feedback/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM segment_feedback WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.var.userId).run();
  return res.meta.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

/**
 * Headers on every response. The CSP allows exactly what the app loads: its own files, the
 * OpenFreeMap basemap (style, tiles, fonts, sprites), Google Fonts, and blob: workers (MapLibre).
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    "connect-src 'self' https://tiles.openfreemap.org",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function secured(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/") || !env.ASSETS) return secured(await app.fetch(req, env, ctx));
    const res = await env.ASSETS.fetch(req);
    // Map tiles outside Singapore don't exist: answer "empty tile" instead of the app's index.html.
    if (url.pathname.startsWith("/data/") && (res.headers.get("Content-Type") ?? "").includes("text/html")) {
      return secured(new Response(null, { status: 204 }));
    }
    return secured(res);
  },
} satisfies ExportedHandler<Env>;
