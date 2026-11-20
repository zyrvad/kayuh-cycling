/** Training goals: a target per period (week, month, year) and metric. Yours only. */
import type { Hono } from "hono";
import type { App } from "./index.ts";
import { goalBody, jsonBody } from "./validate.ts";

const COLUMNS = "id, period, metric, target, created_at AS createdAt";

export function registerGoals(app: Hono<App>) {
  app.get("/api/goals", async (c) => {
    const { results } = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM goals WHERE user_id = ? ORDER BY created_at`)
      .bind(c.var.userId).all();
    return c.json({ goals: results });
  });

  // One goal per period and metric: setting it again changes the target.
  app.put("/api/goals", async (c) => {
    const g = goalBody(await jsonBody(c.req));
    const goal = await c.env.DB.prepare(
      `INSERT INTO goals (id, user_id, period, metric, target) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, period, metric) DO UPDATE SET target = excluded.target
       RETURNING ${COLUMNS}`,
    ).bind(crypto.randomUUID(), c.var.userId, g.period, g.metric, g.target).first();
    return c.json({ goal });
  });

  app.delete("/api/goals/:id", async (c) => {
    const res = await c.env.DB.prepare("DELETE FROM goals WHERE id = ? AND user_id = ?").bind(c.req.param("id"), c.var.userId).run();
    if (!res.meta.changes) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  });
}
