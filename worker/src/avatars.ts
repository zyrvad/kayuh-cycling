/** Profile pictures. Visible to you and the people you share a crew with. */
import type { Hono } from "hono";
import type { App, Ctx } from "./index.ts";
import { avatarBody, jsonBody } from "./validate.ts";

/** A cache-busting URL for a user's picture, or null if they have none. */
export const avatarUrl = (userId: unknown, updatedAt: unknown) =>
  updatedAt ? `/api/avatars/${userId}?v=${encodeURIComponent(String(updatedAt))}` : null;

/** SQL for the `avatar_at` column, given the users table alias. */
export const AVATAR_AT = (u: string) => `(SELECT updated_at FROM avatars WHERE user_id = ${u}.id) AS avatar_at`;

const signIn = (c: Ctx) => c.json({ error: "Sign in to add a profile picture", signIn: true }, 401);

export function registerAvatars(app: Hono<App>) {
  app.put("/api/me/avatar", async (c) => {
    if (!c.var.account) return signIn(c);
    const { mime, data } = avatarBody(await jsonBody(c.req));
    const row = await c.env.DB.prepare(
      `INSERT INTO avatars (user_id, mime, data) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       RETURNING updated_at`,
    ).bind(c.var.userId, mime, data).first<{ updated_at: string }>();
    return c.json({ avatar: avatarUrl(c.var.userId, row!.updated_at) });
  });

  app.delete("/api/me/avatar", async (c) => {
    if (!c.var.account) return signIn(c);
    await c.env.DB.prepare("DELETE FROM avatars WHERE user_id = ?").bind(c.var.userId).run();
    return c.json({ ok: true });
  });

  app.get("/api/avatars/:id", async (c) => {
    const id = c.req.param("id");
    // Yours, or someone you ride with. Anyone else gets the same 404 as a missing picture.
    const row = await c.env.DB.prepare(
      `SELECT a.mime, a.data FROM avatars a
        WHERE a.user_id = ? AND (a.user_id = ? OR EXISTS (
          SELECT 1 FROM crew_members mine JOIN crew_members theirs ON theirs.crew_id = mine.crew_id
           WHERE mine.user_id = ? AND theirs.user_id = a.user_id))`,
    ).bind(id, c.var.userId, c.var.userId).first<{ mime: string; data: string }>();
    if (!row) return c.json({ error: "not found" }, 404);
    const bytes = Uint8Array.from(atob(row.data), (ch) => ch.charCodeAt(0));
    return new Response(bytes, {
      headers: {
        "Content-Type": row.mime,
        // The URL carries ?v=<updated_at>, so a new picture is a new URL.
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": "inline",
      },
    });
  });
}
