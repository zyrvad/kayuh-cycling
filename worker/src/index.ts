import { Hono, type Context, type Next } from "hono";
import { requestEmail, type AuthEnv } from "./auth.ts";
import { getConditions } from "./conditions.ts";
import { registerCrews } from "./crews.ts";
import { searchPlaces } from "./search.ts";
import {
  BadRequest, feedbackBody, inSingapore, jsonBody, meBody, rideBody, routeBody, visibilityBody,
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
      // Start from the device's settings, if it had any.
      await db.prepare(
        `INSERT INTO users (id, kind, email, display_name, operator, cap_minutes, speed_kmh)
         SELECT ?, 'account', ?, ?, COALESCE(d.operator, 'helloride'), COALESCE(d.cap_minutes, 30), COALESCE(d.speed_kmh, 13)
           FROM (SELECT 1) LEFT JOIN users d ON d.id = ? AND d.kind = 'device'`,
      ).bind(id, email, email.split("@")[0], device).run();
      user = { id };
    }
    if (device) await mergeDevice(db, device, user.id);
    c.set("userId", user.id);
    c.set("account", true);
    c.set("email", email);
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
    db.prepare("DELETE FROM users WHERE id = ?").bind(device),
  ]);
}

for (const path of [
  "/api/me", "/api/routes", "/api/routes/*", "/api/rides", "/api/rides/*", "/api/feedback", "/api/feedback/*",
  "/api/crews", "/api/crews/*", "/api/group-rides", "/api/group-rides/*",
]) {
  app.use(path, identify);
}

app.get("/api/me", async (c) => {
  const u = await c.env.DB.prepare("SELECT operator, cap_minutes, speed_kmh, display_name FROM users WHERE id = ?")
    .bind(c.var.userId).first<{ operator: string; cap_minutes: number; speed_kmh: number; display_name: string | null }>();
  return c.json({
    id: c.var.account ? c.var.userId : null, email: c.var.email, displayName: u!.display_name,
    operator: u!.operator, capMinutes: u!.cap_minutes, speedKmh: u!.speed_kmh, signedIn: c.var.account,
  });
});

app.put("/api/me", async (c) => {
  const b = meBody(await body(c));
  await c.env.DB.prepare(
    "UPDATE users SET operator = ?, cap_minutes = ?, speed_kmh = ?, display_name = COALESCE(?, display_name) WHERE id = ?",
  ).bind(b.operator, b.capMinutes, b.speedKmh, b.displayName, c.var.userId).run();
  return c.json(b);
});

registerCrews(app);

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
  const res = await c.env.DB.prepare("DELETE FROM routes WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.var.userId).run();
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
    predictedS: r.predicted_s ?? null,
  };
}

app.get("/api/rides", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM rides WHERE user_id = ? ORDER BY ridden_at DESC LIMIT 500")
    .bind(c.var.userId).all<Record<string, string | number>>();
  return c.json({ rides: results.map(rideOut) });
});

app.post("/api/rides", async (c) => {
  const b = rideBody(await body(c));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO rides (id, user_id, route_id, name, ridden_at, distance_m, time_s, tier_m, polyline, source, visibility, predicted_s)
     VALUES (?, ?, (SELECT id FROM routes WHERE id = ? AND user_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, c.var.userId, b.routeId, c.var.userId, b.name, b.riddenAt, b.distanceM, b.timeS, JSON.stringify(b.tierM),
    b.polyline, b.source, b.visibility, b.predictedS).run();
  return c.json({ id }, 201);
});

app.patch("/api/rides/:id", async (c) => {
  const visibility = visibilityBody(await body(c));
  const res = await c.env.DB.prepare("UPDATE rides SET visibility = ? WHERE id = ? AND user_id = ?")
    .bind(visibility, c.req.param("id"), c.var.userId).run();
  return res.meta.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

app.delete("/api/rides/:id", async (c) => {
  const res = await c.env.DB.prepare("DELETE FROM rides WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.var.userId).run();
  return res.meta.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
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

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/") || !env.ASSETS) return app.fetch(req, env, ctx);
    const res = await env.ASSETS.fetch(req);
    // Map tiles outside Singapore don't exist: answer "empty tile" instead of the app's index.html.
    if (url.pathname.startsWith("/data/") && (res.headers.get("Content-Type") ?? "").includes("text/html")) {
      return new Response(null, { status: 204 });
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
