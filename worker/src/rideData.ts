/** Adding a watch file's heart rate and power to a ride Kayuh recorded: the owner replaces the ride's track and stats. */
import type { Hono } from "hono";
import type { App, Ctx } from "./index.ts";
import { jsonBody, obj, rideStats, track } from "./validate.ts";

export function registerRideData(app: Hono<App>) {
  // Owner only; anyone else gets the same 404 as a ride that doesn't exist.
  app.put("/api/rides/:id/track", async (c: Ctx) => {
    const o = obj(await jsonBody(c.req));
    const t = track(o.track), s = rideStats(o.stats);
    const res = await c.env.DB.prepare("UPDATE rides SET track = ?, stats = ? WHERE id = ? AND user_id = ?")
      .bind(t, s, c.req.param("id"), c.var.userId).run();
    return res.meta.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });
}
