/**
 * Who sees whose rides: sharing a ride with chosen crews and/or followers, follows (private
 * accounts approve each follower), the feed, kudos and comments.
 */
import type { Hono } from "hono";
import type { App, Ctx } from "./index.ts";
import { AVATAR_AT, avatarUrl } from "./avatars.ts";
import { trimEnds } from "./polyline.ts";
import { BadRequest, commentBody, feedQuery, followBody, jsonBody, privateAccountBody, sharingBody } from "./validate.ts";

type Row = Record<string, string | number | null>;
type Stmt = D1PreparedStatement;

const body = (c: Ctx) => jsonBody(c.req);
const notFound = (c: Ctx) => c.json({ error: "not found" }, 404);

/**
 * The visibility rule, in one place. The ids of every ride the viewer may see: their own, rides
 * shared with a crew they're in, and followers-only rides of people they follow (accepted follows
 * only). Bind the viewer's id three times: `...viewer(id)`.
 */
export const VISIBLE_RIDES = `SELECT id FROM rides WHERE user_id = ?
  UNION SELECT s.ride_id FROM ride_shares s JOIN crew_members m ON m.crew_id = s.crew_id WHERE m.user_id = ?
  UNION SELECT r.id FROM follows f JOIN rides r ON r.user_id = f.followee_id
         WHERE f.follower_id = ? AND f.status = 'accepted' AND r.share_followers = 1`;
export const viewer = (id: string) => [id, id, id];

/** Keeps rides.visibility as a summary: 'crew' when shared anywhere. Append a WHERE clause. */
const SYNC_VISIBILITY = `UPDATE rides SET visibility = CASE WHEN share_followers = 1
  OR EXISTS (SELECT 1 FROM ride_shares WHERE ride_id = rides.id) THEN 'crew' ELSE 'private' END`;

/**
 * Statements that replace who a ride is shared with: `crews` lists crew ids (only ones the owner
 * is in take effect) or "all" for every crew the owner is in; `followers` null keeps the current
 * setting. Every statement checks the ride belongs to `ownerId`. Run them in one db.batch.
 */
export function shareStatements(db: D1Database, rideId: string, ownerId: string, crews: string[] | "all", followers: boolean | null): Stmt[] {
  const insert = `INSERT OR IGNORE INTO ride_shares (ride_id, crew_id)
    SELECT r.id, m.crew_id FROM rides r JOIN crew_members m ON m.user_id = r.user_id WHERE r.id = ? AND r.user_id = ?`;
  return [
    db.prepare("DELETE FROM ride_shares WHERE ride_id = (SELECT id FROM rides WHERE id = ? AND user_id = ?)").bind(rideId, ownerId),
    ...(crews === "all"
      ? [db.prepare(insert).bind(rideId, ownerId)]
      : crews.map((crewId) => db.prepare(`${insert} AND m.crew_id = ?`).bind(rideId, ownerId, crewId))),
    db.prepare("UPDATE rides SET share_followers = COALESCE(?, share_followers) WHERE id = ? AND user_id = ?")
      .bind(followers === null ? null : followers ? 1 : 0, rideId, ownerId),
    db.prepare(`${SYNC_VISIBILITY} WHERE id = ? AND user_id = ?`).bind(rideId, ownerId),
  ];
}

/** Leaving a crew un-shares your rides from it. */
export function leaveCrewStatements(db: D1Database, crewId: string, userId: string): Stmt[] {
  return [
    db.prepare("DELETE FROM ride_shares WHERE crew_id = ? AND ride_id IN (SELECT id FROM rides WHERE user_id = ?)").bind(crewId, userId),
    db.prepare(`${SYNC_VISIBILITY} WHERE user_id = ?`).bind(userId),
  ];
}

/** Deleting a ride takes its shares, kudos and comments with it (explicitly, not only by cascade). */
export function deleteRideStatements(db: D1Database, rideId: string, ownerId: string): Stmt[] {
  const owned = "(SELECT id FROM rides WHERE id = ? AND user_id = ?)";
  return [
    db.prepare(`DELETE FROM ride_shares WHERE ride_id = ${owned}`).bind(rideId, ownerId),
    db.prepare(`DELETE FROM kudos WHERE ride_id = ${owned}`).bind(rideId, ownerId),
    db.prepare(`DELETE FROM comments WHERE ride_id = ${owned}`).bind(rideId, ownerId),
    db.prepare("DELETE FROM rides WHERE id = ? AND user_id = ?").bind(rideId, ownerId),
  ];
}

/**
 * People outside your crews: the name they chose, or "Kayuh rider". Never anything from their
 * email (crew screens still fall back to it, since crewmates joined by invite).
 */
export const NO_NAME = "Kayuh rider";
/** Columns for the person in a row aliased `u`. */
export const PERSON_COLUMNS = `u.id AS u_id, u.display_name AS u_name, ${AVATAR_AT("u")}`;
export const person = (r: Row) => ({
  id: r.u_id as string, name: (r.u_name as string) || NO_NAME, avatar: avatarUrl(r.u_id, r.avatar_at),
});

/** Counts for a ride row aliased `r`. Bind the viewer's id once (for `kudoed`). */
export const SOCIAL_COUNTS = `(SELECT COUNT(*) FROM kudos WHERE ride_id = r.id) AS kudos,
  EXISTS (SELECT 1 FROM kudos WHERE ride_id = r.id AND user_id = ?) AS kudoed,
  (SELECT COUNT(*) FROM comments WHERE ride_id = r.id) AS comment_count`;

/** A ride the viewer can see, or null (the same for "doesn't exist" and "not yours to see"). */
async function visibleRide(c: Ctx, id: string) {
  return c.env.DB.prepare(`SELECT id, user_id FROM rides WHERE id = ? AND id IN (${VISIBLE_RIDES})`)
    .bind(id, ...viewer(c.var.userId)).first<{ id: string; user_id: string }>();
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
function followCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Sets a fresh follow code (`only_if_missing` keeps an existing one) and returns the current code. */
async function setFollowCode(db: D1Database, userId: string, onlyIfMissing: boolean): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      await db.prepare(`UPDATE users SET follow_code = ? WHERE id = ?${onlyIfMissing ? " AND follow_code IS NULL" : ""}`)
        .bind(followCode(), userId).run();
      break;
    } catch (e) {
      if (i >= 2) throw e; // a unique-index clash three times in a row isn't bad luck
    }
  }
  return (await db.prepare("SELECT follow_code FROM users WHERE id = ?").bind(userId).first<{ follow_code: string }>())!.follow_code;
}

export function registerSocial(app: Hono<App>) {
  // Every route here needs an account (ACCOUNT_API in index.ts).

  // ------------------------------------------------------------------ sharing a ride

  const ownedRide = (c: Ctx) => c.env.DB.prepare("SELECT id FROM rides WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), c.var.userId).first<{ id: string }>();

  async function sharing(c: Ctx, id: string) {
    const r = await c.env.DB.prepare(
      "SELECT share_followers, (SELECT json_group_array(crew_id) FROM ride_shares WHERE ride_id = rides.id) AS crews FROM rides WHERE id = ?",
    ).bind(id).first<{ share_followers: number; crews: string }>();
    return { crewIds: JSON.parse(r!.crews) as string[], followers: !!r!.share_followers };
  }

  app.get("/api/rides/:id/sharing", async (c) => {
    const r = await ownedRide(c);
    return r ? c.json(await sharing(c, r.id)) : notFound(c);
  });

  app.put("/api/rides/:id/sharing", async (c) => {
    const r = await ownedRide(c);
    if (!r) return notFound(c);
    const b = sharingBody(await body(c));
    const { results } = await c.env.DB.prepare("SELECT crew_id FROM crew_members WHERE user_id = ?").bind(c.var.userId).all<{ crew_id: string }>();
    const mine = new Set(results.map((m) => m.crew_id));
    if (!b.crewIds.every((id) => mine.has(id))) throw new BadRequest("crewIds: you can only share with crews you're in");
    await c.env.DB.batch(shareStatements(c.env.DB, r.id, c.var.userId, b.crewIds, b.followers));
    return c.json(await sharing(c, r.id));
  });

  // ------------------------------------------------------------------ feed

  app.get("/api/feed", async (c) => {
    const q = feedQuery(c.req.query("before"), c.req.query("limit"));
    const me = c.var.userId;
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, r.name, r.ridden_at, r.distance_m, r.time_s, r.tier_m, r.polyline, r.stats, r.user_id, ${PERSON_COLUMNS}, ${SOCIAL_COUNTS}
         FROM rides r JOIN users u ON u.id = r.user_id
        WHERE r.id IN (${VISIBLE_RIDES})
          AND (? IS NULL OR r.ridden_at < ? OR (r.ridden_at = ? AND r.id < ?))
        ORDER BY r.ridden_at DESC, r.id DESC LIMIT ?`,
    ).bind(me, ...viewer(me), q.at, q.at, q.at, q.id, q.limit + 1).all<Row>();
    const page = results.slice(0, q.limit);
    // Which of your crews each ride is shared with, for all of them in one go.
    const { results: shares } = await c.env.DB.prepare(
      `SELECT s.ride_id, k.id, k.name FROM ride_shares s
         JOIN crew_members m ON m.crew_id = s.crew_id AND m.user_id = ? JOIN crews k ON k.id = s.crew_id
        WHERE s.ride_id IN (SELECT value FROM json_each(?)) ORDER BY k.name`,
    ).bind(me, JSON.stringify(page.map((r) => r.id))).all<Row>();
    const crewsOf = new Map<string, { id: string; name: string }[]>();
    for (const s of shares) {
      const list = crewsOf.get(s.ride_id as string) ?? [];
      list.push({ id: s.id as string, name: s.name as string });
      crewsOf.set(s.ride_id as string, list);
    }
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => {
        const mine = r.user_id === me;
        return {
          id: r.id, name: r.name, riddenAt: r.ridden_at, distanceM: r.distance_m, timeS: r.time_s, tierM: JSON.parse(r.tier_m as string),
          // Never send anyone else the first and last 200 m: that's where people's homes are.
          polyline: mine ? r.polyline : trimEnds(r.polyline as string),
          stats: r.stats ? JSON.parse(r.stats as string) : null, mine, rider: person(r),
          kudos: Number(r.kudos), kudoed: !!r.kudoed, comments: Number(r.comment_count), crews: crewsOf.get(r.id as string) ?? [],
        };
      }),
      next: results.length > q.limit && last ? `${last.ridden_at}|${last.id}` : null,
    });
  });

  // ------------------------------------------------------------------ kudos

  async function kudosOut(c: Ctx, rideId: string) {
    const k = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n, COALESCE(MAX(user_id = ?), 0) AS mine FROM kudos WHERE ride_id = ?",
    ).bind(c.var.userId, rideId).first<{ n: number; mine: number }>();
    return { kudos: Number(k!.n), kudoed: !!k!.mine };
  }

  app.post("/api/rides/:id/kudos", async (c) => {
    const r = await visibleRide(c, c.req.param("id"));
    if (!r) return notFound(c);
    if (r.user_id === c.var.userId) throw new BadRequest("You can't give kudos to your own ride");
    await c.env.DB.prepare("INSERT OR IGNORE INTO kudos (ride_id, user_id) VALUES (?, ?)").bind(r.id, c.var.userId).run();
    return c.json(await kudosOut(c, r.id));
  });

  // Taking your kudos back always works, even once the ride is no longer shared with you; but
  // then the reply doesn't say how many others it has.
  app.delete("/api/rides/:id/kudos", async (c) => {
    const id = c.req.param("id");
    const res = await c.env.DB.prepare("DELETE FROM kudos WHERE ride_id = ? AND user_id = ?").bind(id, c.var.userId).run();
    const r = await visibleRide(c, id);
    if (r) return c.json(await kudosOut(c, r.id));
    return res.meta.changes ? c.json({ kudoed: false }) : notFound(c);
  });

  // ------------------------------------------------------------------ comments

  const commentOut = (r: Row, me: string, owner: string) => ({
    id: r.id, body: r.body, createdAt: r.created_at, author: person(r),
    mine: r.u_id === me, canDelete: r.u_id === me || owner === me,
  });

  app.get("/api/rides/:id/comments", async (c) => {
    const r = await visibleRide(c, c.req.param("id"));
    if (!r) return notFound(c);
    const { results } = await c.env.DB.prepare(
      `SELECT k.id, k.body, k.created_at, ${PERSON_COLUMNS} FROM comments k JOIN users u ON u.id = k.user_id
        WHERE k.ride_id = ? ORDER BY k.created_at, k.rowid LIMIT 500`,
    ).bind(r.id).all<Row>();
    return c.json({ comments: results.map((k) => commentOut(k, c.var.userId, r.user_id)) });
  });

  app.post("/api/rides/:id/comments", async (c) => {
    const r = await visibleRide(c, c.req.param("id"));
    if (!r) return notFound(c);
    const text = commentBody(await body(c));
    const id = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO comments (id, ride_id, user_id, body) VALUES (?, ?, ?, ?)").bind(id, r.id, c.var.userId, text).run();
    const k = await c.env.DB.prepare(
      `SELECT k.id, k.body, k.created_at, ${PERSON_COLUMNS} FROM comments k JOIN users u ON u.id = k.user_id WHERE k.id = ?`,
    ).bind(id).first<Row>();
    return c.json({ comment: commentOut(k!, c.var.userId, r.user_id) }, 201);
  });

  // Your own comment, always (even once the ride is no longer shared with you), or any comment on your ride.
  app.delete("/api/comments/:id", async (c) => {
    const me = c.var.userId;
    const res = await c.env.DB.prepare(
      "DELETE FROM comments WHERE id = ? AND (user_id = ? OR ride_id IN (SELECT id FROM rides WHERE user_id = ?))",
    ).bind(c.req.param("id"), me, me).run();
    return res.meta.changes ? c.json({ ok: true }) : notFound(c);
  });

  // ------------------------------------------------------------------ follows

  app.get("/api/me/follow", async (c) => {
    const db = c.env.DB, me = c.var.userId;
    const code = await setFollowCode(db, me, true);
    const u = await db.prepare("SELECT private_account FROM users WHERE id = ?").bind(me).first<{ private_account: number }>();
    const { results } = await db.prepare(
      `SELECT f.follower_id, f.status, ${PERSON_COLUMNS} FROM follows f
         JOIN users u ON u.id = CASE WHEN f.follower_id = ? THEN f.followee_id ELSE f.follower_id END
        WHERE f.follower_id = ? OR f.followee_id = ? ORDER BY f.created_at DESC`,
    ).bind(me, me, me).all<Row>();
    const { results: crewmates } = await db.prepare(
      `SELECT DISTINCT ${PERSON_COLUMNS} FROM crew_members mine
         JOIN crew_members theirs ON theirs.crew_id = mine.crew_id AND theirs.user_id != mine.user_id
         JOIN users u ON u.id = theirs.user_id
        WHERE mine.user_id = ? AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = u.id)
        ORDER BY u.display_name LIMIT 10`,
    ).bind(me, me).all<Row>();
    const pick = (outgoing: boolean, status: string) =>
      results.filter((r) => (r.follower_id === me) === outgoing && r.status === status).map(person);
    return c.json({
      code, privateAccount: !!u!.private_account,
      followers: pick(false, "accepted"), following: pick(true, "accepted"),
      requests: pick(false, "pending"), outgoing: pick(true, "pending"),
      suggestions: crewmates.map(person),
    });
  });

  /** Going public approves everyone who's waiting. */
  app.put("/api/me/follow", async (c) => {
    const priv = privateAccountBody(await body(c));
    const db = c.env.DB;
    await db.batch([
      db.prepare("UPDATE users SET private_account = ? WHERE id = ?").bind(priv ? 1 : 0, c.var.userId),
      ...(priv ? [] : [db.prepare("UPDATE follows SET status = 'accepted' WHERE followee_id = ? AND status = 'pending'").bind(c.var.userId)]),
    ]);
    return c.json({ privateAccount: priv });
  });

  /** A fresh follow link; the old one stops working (people already following stay). */
  app.post("/api/me/follow/code", async (c) => c.json({ code: await setFollowCode(c.env.DB, c.var.userId, false) }));

  app.post("/api/follow", async (c) => {
    const b = followBody(await body(c));
    const db = c.env.DB, me = c.var.userId;
    const cols = "u.id, u.display_name, u.private_account";
    // By link, or by id for someone you share a crew with (ids alone never let strangers find you).
    const target = "code" in b
      ? await db.prepare(`SELECT ${cols} FROM users u WHERE u.follow_code = ? AND u.kind = 'account'`).bind(b.code).first<Row>()
      : await db.prepare(
        `SELECT ${cols} FROM users u WHERE u.id = ? AND EXISTS (
           SELECT 1 FROM crew_members mine JOIN crew_members theirs ON theirs.crew_id = mine.crew_id
            WHERE mine.user_id = ? AND theirs.user_id = u.id)`,
      ).bind(b.userId, me).first<Row>();
    if (!target) return c.json({ error: "That follow link isn't valid any more. Ask for a new one." }, 404);
    if (target.id === me) throw new BadRequest("You can't follow yourself");
    const row = await db.prepare(
      `INSERT INTO follows (follower_id, followee_id, status) VALUES (?, ?, ?)
       ON CONFLICT (follower_id, followee_id) DO UPDATE SET status = CASE WHEN excluded.status = 'accepted' THEN 'accepted' ELSE follows.status END
       RETURNING status`,
    ).bind(me, target.id, target.private_account ? "pending" : "accepted").first<{ status: "pending" | "accepted" }>();
    return c.json({ status: row!.status, user: { id: target.id, name: (target.display_name as string) || NO_NAME } });
  });

  const done = (c: Ctx, changes: number) => (changes ? c.json({ ok: true }) : notFound(c));

  app.post("/api/follow/requests/:userId/accept", async (c) => {
    const res = await c.env.DB.prepare("UPDATE follows SET status = 'accepted' WHERE follower_id = ? AND followee_id = ? AND status = 'pending'")
      .bind(c.req.param("userId"), c.var.userId).run();
    return done(c, res.meta.changes);
  });

  app.delete("/api/follow/requests/:userId", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ? AND status = 'pending'")
      .bind(c.req.param("userId"), c.var.userId).run();
    return done(c, res.meta.changes);
  });

  /** Unfollow, or cancel a request you sent. */
  app.delete("/api/following/:userId", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?")
      .bind(c.var.userId, c.req.param("userId")).run();
    return done(c, res.meta.changes);
  });

  app.delete("/api/followers/:userId", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?")
      .bind(c.req.param("userId"), c.var.userId).run();
    return done(c, res.meta.changes);
  });
}
