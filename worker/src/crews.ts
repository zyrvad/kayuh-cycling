/** Crews (friend groups joined by invite link) and the group rides they plan together. */
import type { Hono, Next } from "hono";
import type { App, Ctx } from "./index.ts";
import { AVATAR_AT, avatarUrl } from "./avatars.ts";
import { trimEnds } from "./polyline.ts";
import { crewNameBody, crewRouteBody, groupRideBody, joinBody, jsonBody, rsvpBody } from "./validate.ts";

const body = (c: Ctx) => jsonBody(c.req);

type Row = Record<string, string | number | null>;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

function inviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Crews need a real account: a device id can't be invited or recognised by friends. */
async function requireAccount(c: Ctx, next: Next) {
  if (!c.var.account) return c.json({ error: "Sign in to use crews", signIn: true }, 401);
  await next();
}

async function membership(c: Ctx, crewId: string): Promise<"owner" | "member" | null> {
  const m = await c.env.DB.prepare("SELECT role FROM crew_members WHERE crew_id = ? AND user_id = ?")
    .bind(crewId, c.var.userId).first<{ role: "owner" | "member" }>();
  return m?.role ?? null;
}

const notFound = (c: Ctx) => c.json({ error: "not found" }, 404);

function rideSummary(r: Row) {
  return {
    id: r.id, crewId: r.crew_id, crewName: r.crew_name ?? undefined, title: r.title, startsAt: r.starts_at,
    meet: { name: r.meet_name, lon: r.meet_lon, lat: r.meet_lat },
    distanceM: r.distance_m, timeS: r.time_s, tierM: JSON.parse(r.tier_m as string), legs: r.legs,
    going: Number(r.going ?? 0), myStatus: r.my_status ?? null,
  };
}

const RIDE_COLUMNS = `g.*, c.name AS crew_name,
  (SELECT COUNT(*) FROM rsvps WHERE ride_id = g.id AND status = 'going') AS going,
  (SELECT status FROM rsvps WHERE ride_id = g.id AND user_id = ?) AS my_status`;

/** iCalendar text for one ride (times in UTC). */
function ics(r: Row, url: string): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(r.starts_at as string);
  const end = new Date(start.getTime() + Math.max(1800, Number(r.time_s)) * 1000);
  // Escape per RFC 5545, and turn every kind of line break into a literal \n so user text
  // (titles, notes) can't start new calendar fields.
  const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\r\n|\r|\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kayuh//Group ride//EN", "BEGIN:VEVENT",
    `UID:${r.id}@kayuh`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(`🚲 ${r.title}`)}`,
    `LOCATION:${esc(r.meet_name as string)}`,
    `GEO:${r.meet_lat};${r.meet_lon}`,
    `DESCRIPTION:${esc(`${(Number(r.distance_m) / 1000).toFixed(1)} km with ${r.crew_name}. Meet at ${r.meet_name}.${r.notes ? `\n${r.notes}` : ""}\n${url}`)}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

export function registerCrews(app: Hono<App>) {
  for (const p of ["/api/crews", "/api/crews/*", "/api/group-rides", "/api/group-rides/*"]) app.use(p, requireAccount);

  // ------------------------------------------------------------------ crews

  app.get("/api/crews", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT c.id, c.name, m.role,
              (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id) AS members,
              (SELECT MIN(starts_at) FROM group_rides WHERE crew_id = c.id AND starts_at >= ?) AS next_ride
         FROM crews c JOIN crew_members m ON m.crew_id = c.id
        WHERE m.user_id = ? ORDER BY c.created_at`,
    ).bind(new Date(Date.now() - 3 * 3600_000).toISOString(), c.var.userId).all<Row>();
    return c.json({ crews: results.map((r) => ({ id: r.id, name: r.name, role: r.role, members: r.members, nextRide: r.next_ride })) });
  });

  app.post("/api/crews", async (c) => {
    const name = crewNameBody(await body(c));
    const id = crypto.randomUUID();
    const code = inviteCode();
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO crews (id, name, invite_code, created_by) VALUES (?, ?, ?, ?)").bind(id, name, code, c.var.userId),
      c.env.DB.prepare("INSERT INTO crew_members (crew_id, user_id, role) VALUES (?, ?, 'owner')").bind(id, c.var.userId),
    ]);
    return c.json({ id, inviteCode: code }, 201);
  });

  app.post("/api/crews/join", async (c) => {
    const code = joinBody(await body(c));
    const crew = await c.env.DB.prepare("SELECT id, name FROM crews WHERE invite_code = ?").bind(code).first<{ id: string; name: string }>();
    if (!crew) return c.json({ error: "That invite link isn't valid any more. Ask for a new one." }, 404);
    await c.env.DB.prepare("INSERT OR IGNORE INTO crew_members (crew_id, user_id) VALUES (?, ?)").bind(crew.id, c.var.userId).run();
    return c.json({ crewId: crew.id, name: crew.name });
  });

  app.get("/api/crews/:id", async (c) => {
    const id = c.req.param("id");
    const role = await membership(c, id);
    if (!role) return notFound(c);
    const crew = await c.env.DB.prepare("SELECT id, name, invite_code FROM crews WHERE id = ?").bind(id).first<Row>();
    const { results: members } = await c.env.DB.prepare(
      `SELECT u.id, u.display_name, u.email, u.operator, u.cap_minutes, m.role, ${AVATAR_AT("u")}
         FROM crew_members m JOIN users u ON u.id = m.user_id
        WHERE m.crew_id = ? ORDER BY m.role = 'owner' DESC, m.joined_at, m.rowid`,
    ).bind(id).all<Row>();
    const { results: rides } = await c.env.DB.prepare(
      `SELECT ${RIDE_COLUMNS} FROM group_rides g JOIN crews c ON c.id = g.crew_id
        WHERE g.crew_id = ? AND g.starts_at >= ? ORDER BY g.starts_at LIMIT 50`,
    ).bind(c.var.userId, id, new Date(Date.now() - 3 * 3600_000).toISOString()).all<Row>();
    return c.json({
      id: crew!.id, name: crew!.name, role, inviteCode: crew!.invite_code,
      members: members.map((m) => ({
        id: m.id, name: m.display_name || String(m.email).split("@")[0], operator: m.operator, capMinutes: m.cap_minutes,
        role: m.role, me: m.id === c.var.userId, avatar: avatarUrl(m.id, m.avatar_at),
      })),
      rides: rides.map(rideSummary),
    });
  });

  app.patch("/api/crews/:id", async (c) => {
    if ((await membership(c, c.req.param("id"))) !== "owner") return notFound(c);
    const name = crewNameBody(await body(c));
    await c.env.DB.prepare("UPDATE crews SET name = ? WHERE id = ?").bind(name, c.req.param("id")).run();
    return c.json({ ok: true });
  });

  /** A fresh invite link; the old one stops working. */
  app.post("/api/crews/:id/invite", async (c) => {
    if ((await membership(c, c.req.param("id"))) !== "owner") return notFound(c);
    const code = inviteCode();
    await c.env.DB.prepare("UPDATE crews SET invite_code = ? WHERE id = ?").bind(code, c.req.param("id")).run();
    return c.json({ inviteCode: code });
  });

  app.delete("/api/crews/:id/members/me", async (c) => {
    const id = c.req.param("id");
    const role = await membership(c, id);
    if (!role) return notFound(c);
    const db = c.env.DB;
    await db.batch([
      db.prepare("DELETE FROM crew_members WHERE crew_id = ? AND user_id = ?").bind(id, c.var.userId),
      db.prepare("DELETE FROM crew_routes WHERE crew_id = ? AND shared_by = ?").bind(id, c.var.userId),
    ]);
    const next = await db.prepare("SELECT user_id FROM crew_members WHERE crew_id = ? ORDER BY joined_at, rowid LIMIT 1").bind(id).first<{ user_id: string }>();
    if (!next) {
      await db.batch([
        db.prepare("DELETE FROM rsvps WHERE ride_id IN (SELECT id FROM group_rides WHERE crew_id = ?)").bind(id),
        db.prepare("DELETE FROM group_rides WHERE crew_id = ?").bind(id),
        db.prepare("DELETE FROM crew_routes WHERE crew_id = ?").bind(id),
        db.prepare("DELETE FROM crews WHERE id = ?").bind(id),
      ]);
    } else if (role === "owner") {
      await db.prepare("UPDATE crew_members SET role = 'owner' WHERE crew_id = ? AND user_id = ?").bind(id, next.user_id).run();
    }
    return c.json({ ok: true });
  });

  /** Rides your crewmates chose to share with the crew (rides are private by default). */
  app.get("/api/crews/:id/rides", async (c) => {
    const id = c.req.param("id");
    if (!(await membership(c, id))) return notFound(c);
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, r.name, r.ridden_at, r.distance_m, r.time_s, r.tier_m, r.polyline, u.display_name, u.email, u.id AS user_id
         FROM rides r JOIN crew_members m ON m.user_id = r.user_id AND m.crew_id = ?
         JOIN users u ON u.id = r.user_id
        WHERE r.visibility = 'crew' ORDER BY r.ridden_at DESC LIMIT 100`,
    ).bind(id).all<Row>();
    return c.json({
      rides: results.map((r) => ({
        id: r.id, name: r.name, riddenAt: r.ridden_at, distanceM: r.distance_m, timeS: r.time_s,
        // Never send the first and last 200 m: that's where people's homes are.
        tierM: JSON.parse(r.tier_m as string), polyline: trimEnds(r.polyline as string),
        rider: r.display_name || String(r.email).split("@")[0], mine: r.user_id === c.var.userId,
      })),
    });
  });

  // ------------------------------------------------------------------ routes shared with the crew

  app.post("/api/crews/:id/routes", async (c) => {
    const crewId = c.req.param("id");
    if (!(await membership(c, crewId))) return notFound(c);
    const b = crewRouteBody(await body(c));
    const route = await c.env.DB.prepare("SELECT id FROM routes WHERE id = ? AND user_id = ?").bind(b.routeId, c.var.userId).first();
    if (!route) return c.json({ error: "You can only share your own saved routes" }, 404);
    await c.env.DB.prepare(
      `INSERT INTO crew_routes (crew_id, route_id, shared_by, note) VALUES (?, ?, ?, ?)
       ON CONFLICT (crew_id, route_id) DO UPDATE SET note = excluded.note, shared_at = datetime('now')`,
    ).bind(crewId, b.routeId, c.var.userId, b.note).run();
    return c.json({ ok: true }, 201);
  });

  app.get("/api/crews/:id/routes", async (c) => {
    const crewId = c.req.param("id");
    const role = await membership(c, crewId);
    if (!role) return notFound(c);
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, r.name, r.mode, r.profile, r.points, r.prefs, r.distance_m, r.time_s, r.tier_m, r.legs, r.polyline,
              s.note, s.shared_at, s.shared_by, u.display_name, u.email
         FROM crew_routes s JOIN routes r ON r.id = s.route_id JOIN users u ON u.id = s.shared_by
        WHERE s.crew_id = ? ORDER BY s.shared_at DESC LIMIT 100`,
    ).bind(crewId).all<Row>();
    return c.json({
      routes: results.map((r) => ({
        id: r.id, name: r.name, mode: r.mode, profile: r.profile,
        points: JSON.parse(r.points as string), prefs: JSON.parse(r.prefs as string),
        distanceM: r.distance_m, timeS: r.time_s, tierM: JSON.parse(r.tier_m as string), legs: r.legs, polyline: r.polyline,
        note: r.note ?? null, sharedAt: r.shared_at, sharedBy: r.display_name || String(r.email).split("@")[0],
        mine: r.shared_by === c.var.userId, canRemove: r.shared_by === c.var.userId || role === "owner",
      })),
    });
  });

  app.delete("/api/crews/:id/routes/:routeId", async (c) => {
    const crewId = c.req.param("id");
    const role = await membership(c, crewId);
    if (!role) return notFound(c);
    const res = await c.env.DB.prepare(
      "DELETE FROM crew_routes WHERE crew_id = ? AND route_id = ? AND (shared_by = ? OR ? = 'owner')",
    ).bind(crewId, c.req.param("routeId"), c.var.userId, role).run();
    return res.meta.changes ? c.json({ ok: true }) : notFound(c);
  });

  // ------------------------------------------------------------------ group rides

  app.post("/api/crews/:id/group-rides", async (c) => {
    const crewId = c.req.param("id");
    if (!(await membership(c, crewId))) return notFound(c);
    const b = groupRideBody(await body(c));
    const id = crypto.randomUUID();
    const r = b.route;
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO group_rides (id, crew_id, created_by, title, starts_at, notes, meet_lon, meet_lat, meet_name,
                                  route_name, points, prefs, distance_m, time_s, tier_m, legs, polyline)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, crewId, c.var.userId, b.title, b.startsAt, b.notes, b.meet.lon, b.meet.lat, b.meet.name,
        r.name, JSON.stringify(r.points), JSON.stringify(r.prefs), r.distanceM, r.timeS, JSON.stringify(r.tierM), r.legs, r.polyline),
      // Whoever plans it is going.
      c.env.DB.prepare("INSERT INTO rsvps (ride_id, user_id, status) VALUES (?, ?, 'going')").bind(id, c.var.userId),
    ]);
    return c.json({ id }, 201);
  });

  /** Upcoming rides across all your crews. */
  app.get("/api/group-rides", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT ${RIDE_COLUMNS} FROM group_rides g JOIN crews c ON c.id = g.crew_id
        JOIN crew_members m ON m.crew_id = g.crew_id AND m.user_id = ?
        WHERE g.starts_at >= ? ORDER BY g.starts_at LIMIT 50`,
    ).bind(c.var.userId, c.var.userId, new Date(Date.now() - 3 * 3600_000).toISOString()).all<Row>();
    return c.json({ rides: results.map(rideSummary) });
  });

  async function loadRide(c: Ctx) {
    const r = await c.env.DB.prepare(
      `SELECT g.*, c.name AS crew_name FROM group_rides g JOIN crews c ON c.id = g.crew_id
        JOIN crew_members m ON m.crew_id = g.crew_id AND m.user_id = ?
        WHERE g.id = ?`,
    ).bind(c.var.userId, c.req.param("id")).first<Row>();
    return r;
  }

  app.get("/api/group-rides/:id", async (c) => {
    const r = await loadRide(c);
    if (!r) return notFound(c);
    const { results: people } = await c.env.DB.prepare(
      `SELECT u.id, u.display_name, u.email, u.operator, u.cap_minutes, s.status, ${AVATAR_AT("u")}
         FROM crew_members m JOIN users u ON u.id = m.user_id
         LEFT JOIN rsvps s ON s.ride_id = ? AND s.user_id = u.id
        WHERE m.crew_id = ? ORDER BY s.status IS NULL, s.status, u.display_name`,
    ).bind(r.id, r.crew_id).all<Row>();
    const going = people.filter((p) => p.status === "going");
    // Everyone on a rental pass needs the route split for the strictest free-ride limit.
    const caps = going.filter((p) => p.operator !== "own").map((p) => Number(p.cap_minutes));
    return c.json({
      id: r.id, crewId: r.crew_id, crewName: r.crew_name, title: r.title, startsAt: r.starts_at, notes: r.notes,
      meet: { name: r.meet_name, lon: r.meet_lon, lat: r.meet_lat },
      route: {
        name: r.route_name, points: JSON.parse(r.points as string), prefs: JSON.parse(r.prefs as string),
        distanceM: r.distance_m, timeS: r.time_s, tierM: JSON.parse(r.tier_m as string), legs: r.legs, polyline: r.polyline,
      },
      people: people.map((p) => ({
        id: p.id, name: p.display_name || String(p.email).split("@")[0], operator: p.operator, capMinutes: p.cap_minutes,
        status: p.status ?? null, me: p.id === c.var.userId, avatar: avatarUrl(p.id, p.avatar_at),
      })),
      strictestCapMinutes: caps.length ? Math.min(...caps) : null,
      canDelete: r.created_by === c.var.userId || (await membership(c, r.crew_id as string)) === "owner",
    });
  });

  app.put("/api/group-rides/:id/rsvp", async (c) => {
    const r = await loadRide(c);
    if (!r) return notFound(c);
    const status = rsvpBody(await body(c));
    await c.env.DB.prepare(
      `INSERT INTO rsvps (ride_id, user_id, status) VALUES (?, ?, ?)
       ON CONFLICT (ride_id, user_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`,
    ).bind(r.id, c.var.userId, status).run();
    return c.json({ status });
  });

  app.delete("/api/group-rides/:id", async (c) => {
    const r = await loadRide(c);
    if (!r) return notFound(c);
    if (r.created_by !== c.var.userId && (await membership(c, r.crew_id as string)) !== "owner") return notFound(c);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM rsvps WHERE ride_id = ?").bind(r.id),
      c.env.DB.prepare("DELETE FROM group_rides WHERE id = ?").bind(r.id),
    ]);
    return c.json({ ok: true });
  });

  app.get("/api/group-rides/:id/ics", async (c) => {
    const r = await loadRide(c);
    if (!r) return notFound(c);
    const url = new URL(c.req.url);
    return new Response(ics(r, `${url.origin}/ride/${r.id}`), {
      headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="kayuh-ride.ics"` },
    });
  });
}
