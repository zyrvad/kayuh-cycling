/**
 * Heart rate from Apple Health via an iOS Shortcut. Health data: owner only, never in the feed, crews or sharing.
 *
 *   POST   /api/rides/:id/hr-token    owner mints a 24 h token for one ride (only its SHA-256 hash is stored)
 *   POST   /api/hr/:token             the Shortcut uploads samples; no identity, the token is the only authority
 *   GET    /api/rides/:id/hr-pending  owner reads what was uploaded
 *   DELETE /api/rides/:id/hr-pending  owner clears it once merged
 */
import type { Hono } from "hono";
import type { App, Ctx } from "./index.ts";

const TTL_MS = 24 * 3600 * 1000;
const MAX_BYTES = 1_000_000;
const MAX_LINES = 50_000;
const SLACK_MS = 10 * 60 * 1000;
const MIN_BPM = 25, MAX_BPM = 250;

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

interface RideTimes { ridden_at: string; time_s: number; stats: string | null }

/** The ride's window in ms: start, and end from the longer of elapsed time on the ride row and in its stats. */
function rideWindow(r: RideTimes): { start: number; end: number } {
  const start = Date.parse(r.ridden_at);
  let s = r.time_s;
  try { s = Math.max(s, (JSON.parse(r.stats ?? "null")?.elapsedS as number) || 0); } catch { /* no stats */ }
  return { start, end: start + s * 1000 };
}

/** Keep valid "ISO time,bpm" lines inside [lo, hi]; returns [epoch ms, bpm] pairs in time order, de-duplicated by time. */
export function cleanSamples(input: unknown, lo: number, hi: number): [number, number][] | null {
  let rows: { t: unknown; bpm: unknown }[];
  if (typeof input === "string") {
    const lines = input.split(/\r?\n/);
    if (lines.length > MAX_LINES) return null;
    rows = lines.map((l) => {
      const i = l.lastIndexOf(",");
      return i < 0 ? { t: "", bpm: "" } : { t: l.slice(0, i).trim(), bpm: l.slice(i + 1).trim() };
    });
  } else if (Array.isArray(input)) {
    if (input.length > MAX_LINES) return null;
    rows = input.map((x) => (x && typeof x === "object" ? (x as { t: unknown; bpm: unknown }) : { t: "", bpm: "" }));
  } else return null;
  const out = new Map<number, number>();
  for (const { t, bpm } of rows) {
    if (typeof t !== "string" || t.length > 40) continue;
    const ms = Date.parse(t);
    const v = typeof bpm === "number" ? bpm : typeof bpm === "string" && /^\d{1,3}(\.\d+)?$/.test(bpm) ? Number(bpm) : NaN;
    if (!Number.isFinite(ms) || !Number.isFinite(v) || v < MIN_BPM || v > MAX_BPM || ms < lo || ms > hi) continue;
    out.set(ms, Math.round(v));
  }
  return [...out].sort((a, b) => a[0] - b[0]);
}

export function registerHrUpload(app: Hono<App>) {
  const ownRide = (c: Ctx) => c.env.DB.prepare("SELECT ridden_at, time_s, stats FROM rides WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.var.userId).first<RideTimes>();

  app.post("/api/rides/:id/hr-token", async (c: Ctx) => {
    const r = await ownRide(c);
    if (!r) return c.json({ error: "not found" }, 404);
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const now = Date.now();
    await c.env.DB.prepare("DELETE FROM hr_tokens WHERE expires_at < ?").bind(new Date(now).toISOString()).run();
    await c.env.DB.prepare("INSERT INTO hr_tokens (token_hash, ride_id, user_id, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256Hex(token), c.req.param("id"), c.var.userId, new Date(now + TTL_MS).toISOString()).run();
    const w = rideWindow(r);
    return c.json({
      token, uploadUrl: `${new URL(c.req.url).origin}/api/hr/${token}`,
      start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString(),
    });
  });

  // No identity: the token is the only authority. Unknown and expired tokens look identical. Never returns ride data.
  app.post("/api/hr/:token", async (c: Ctx) => {
    const declared = Number(c.req.header("Content-Length") ?? 0);
    if (declared > MAX_BYTES) return c.json({ error: "too large" }, 413);
    const text = await c.req.text();
    if (text.length > MAX_BYTES) return c.json({ error: "too large" }, 413);
    const hash = await sha256Hex(c.req.param("token") ?? "");
    const t = await c.env.DB.prepare(
      `SELECT t.ride_id, t.user_id, t.expires_at, r.ridden_at, r.time_s, r.stats FROM hr_tokens t JOIN rides r ON r.id = t.ride_id AND r.user_id = t.user_id
        WHERE t.token_hash = ?`,
    ).bind(hash).first<{ ride_id: string; user_id: string; expires_at: string } & RideTimes>();
    if (!t || Date.parse(t.expires_at) < Date.now()) return c.json({ error: "not found" }, 404);
    let o: unknown;
    try { o = JSON.parse(text); } catch { return c.json({ error: "expected a JSON body" }, 400); }
    const w = rideWindow(t);
    const samples = o && typeof o === "object" ? cleanSamples((o as { samples?: unknown }).samples, w.start - SLACK_MS, w.end + SLACK_MS) : null;
    if (samples === null) return c.json({ error: "expected samples as lines or a list, at most 50000" }, 400);
    if (!samples.length) return c.json({ error: "no usable heart rate readings", accepted: 0 }, 422);
    await c.env.DB.prepare(
      "INSERT INTO ride_hr_pending (ride_id, user_id, samples) VALUES (?, ?, ?) ON CONFLICT (ride_id) DO UPDATE SET samples = excluded.samples, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    ).bind(t.ride_id, t.user_id, JSON.stringify(samples)).run();
    return c.json({ ok: true, accepted: samples.length });
  });

  app.get("/api/rides/:id/hr-pending", async (c: Ctx) => {
    const p = await c.env.DB.prepare("SELECT samples FROM ride_hr_pending WHERE ride_id = ? AND user_id = ?")
      .bind(c.req.param("id"), c.var.userId).first<{ samples: string }>();
    const rows: [number, number][] = p ? JSON.parse(p.samples) : [];
    return c.json({ samples: rows.map(([ms, bpm]) => ({ t: new Date(ms).toISOString(), bpm })) });
  });

  app.delete("/api/rides/:id/hr-pending", async (c: Ctx) => {
    await c.env.DB.prepare("DELETE FROM ride_hr_pending WHERE ride_id = ? AND user_id = ?").bind(c.req.param("id"), c.var.userId).run();
    return c.json({ ok: true });
  });
}
