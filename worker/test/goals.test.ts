import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { app, type Env } from "../src/index.ts";
import { testDb } from "./d1shim.ts";

const ALICE = "alice@example.com", BOB = "bob@example.com";
let env: Env;

beforeEach(() => { env = { DB: testDb(), DEV_AUTH: "1" }; });

async function call(method: string, path: string, opts: { as?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.as) headers["X-Dev-Email"] = opts.as;
  const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

test("goals need an account", async () => {
  assert.equal((await call("GET", "/api/goals")).status, 401);
  assert.equal((await call("PUT", "/api/goals", { body: { period: "week", metric: "rides", target: 3 } })).status, 401);
});

test("validation: bounds per metric, period and metric names", async () => {
  const put = (body: object) => call("PUT", "/api/goals", { as: ALICE, body });
  for (const body of [
    { period: "week", metric: "distance", target: 0.5 }, { period: "week", metric: "distance", target: 100_001 },
    { period: "month", metric: "time", target: 0 }, { period: "month", metric: "time", target: 5_001 },
    { period: "year", metric: "rides", target: 0 }, { period: "year", metric: "rides", target: 2_001 },
    { period: "day", metric: "rides", target: 3 }, { period: "week", metric: "calories", target: 3 },
    { period: "week", metric: "rides", target: "3" }, { period: "week", metric: "rides", target: -1 },
  ]) assert.equal((await put(body)).status, 400, JSON.stringify(body));
  for (const body of [
    { period: "week", metric: "distance", target: 1 }, { period: "year", metric: "distance", target: 100_000 },
    { period: "month", metric: "time", target: 5_000 }, { period: "year", metric: "rides", target: 2_000 },
  ]) assert.equal((await put(body)).status, 200, JSON.stringify(body));
});

test("PUT upserts one goal per period and metric", async () => {
  const a = await call("PUT", "/api/goals", { as: ALICE, body: { period: "month", metric: "distance", target: 100 } });
  const b = await call("PUT", "/api/goals", { as: ALICE, body: { period: "month", metric: "distance", target: 150.5 } });
  await call("PUT", "/api/goals", { as: ALICE, body: { period: "week", metric: "distance", target: 30 } });
  assert.equal(b.json.goal.id, a.json.goal.id);
  const { goals } = (await call("GET", "/api/goals", { as: ALICE })).json;
  assert.equal(goals.length, 2);
  assert.equal(goals.find((g: any) => g.period === "month").target, 150.5);
  assert.deepEqual((await call("GET", "/api/goals", { as: BOB })).json.goals, []);
});

test("only the owner deletes a goal", async () => {
  const { goal } = (await call("PUT", "/api/goals", { as: ALICE, body: { period: "week", metric: "rides", target: 3 } })).json;
  assert.equal((await call("DELETE", `/api/goals/${goal.id}`, { as: BOB })).status, 404);
  assert.equal((await call("GET", "/api/goals", { as: ALICE })).json.goals.length, 1);
  assert.equal((await call("DELETE", `/api/goals/${goal.id}`, { as: ALICE })).status, 200);
  assert.equal((await call("DELETE", `/api/goals/${goal.id}`, { as: ALICE })).status, 404);
  assert.deepEqual((await call("GET", "/api/goals", { as: ALICE })).json.goals, []);
});
