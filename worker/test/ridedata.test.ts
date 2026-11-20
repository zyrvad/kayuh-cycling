import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { app, type Env } from "../src/index.ts";
import { encodePolyline } from "../src/polyline.ts";
import { testDb } from "./d1shim.ts";

const ALICE = "alice@example.com", BOB = "bob@example.com";
let env: Env;
const BASE = { operator: "helloride", capMinutes: 30, speedKmh: 13 };

beforeEach(async () => {
  env = { DB: testDb(), DEV_AUTH: "1" };
  for (const as of [ALICE, BOB]) await call("PUT", "/api/me", { as, body: { ...BASE, displayName: as[0].toUpperCase() } });
});

async function call(method: string, path: string, opts: { as: string; body?: unknown }) {
  const res = await app.request(path, {
    method, headers: { "Content-Type": "application/json", "X-Dev-Email": opts.as }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  }, env);
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

const LINE = encodePolyline(Array.from({ length: 31 }, (_, i) => [103.8 + i * 0.001, 1.35] as [number, number]));
const STATS = { movingS: 900, elapsedS: 950, distanceM: 3000, avgKmh: 12, maxKmh: 20, stops: 0, stoppedS: 0, bests: { "1000": 300 } };
const ride = {
  name: "Coast", riddenAt: "2026-11-01T07:00:00.000Z", distanceM: 3000, timeS: 900, tierM: [3000, 0, 0, 0, 0, 0], polyline: LINE,
  source: "recorded", track: { v: 1, p: LINE, t: [0, 1, 1] }, stats: STATS,
};
const MERGED = {
  track: { v: 2, p: LINE, t: [0, 1, 1], h: [120, 125, 130], w: [150, null, 300] },
  stats: { ...STATS, avgHr: 125, maxHr: 130, hrZones: [0, 3, 0, 0, 0], effort: 1, load: 1, avgPower: 225, maxPower: 300, np: 230, powerCurve: { "5": 200 } },
};

test("the owner adds watch data to a ride's track and stats", async () => {
  const id = (await call("POST", "/api/rides", { as: ALICE, body: ride })).json.id;
  assert.equal((await call("PUT", `/api/rides/${id}/track`, { as: ALICE, body: MERGED })).status, 200);
  const r = (await call("GET", `/api/rides/${id}`, { as: ALICE })).json.ride;
  assert.deepEqual([r.track.v, r.track.h, r.track.w], [2, [120, 125, 130], [150, null, 300]]);
  assert.equal(r.stats.avgHr, 125);
  assert.equal(r.stats.powerCurve["5"], 200);
});

test("not the owner: 404 and nothing changes", async () => {
  const id = (await call("POST", "/api/rides", { as: ALICE, body: ride })).json.id;
  assert.equal((await call("PUT", `/api/rides/${id}/track`, { as: BOB, body: MERGED })).status, 404);
  assert.equal((await call("PUT", `/api/rides/${crypto.randomUUID()}/track`, { as: ALICE, body: MERGED })).status, 404);
  const r = (await call("GET", `/api/rides/${id}`, { as: ALICE })).json.ride;
  assert.equal(r.track.v, 1);
  assert.equal(r.stats.avgHr, undefined);
});

test("the same validation rules as saving a ride", async () => {
  const id = (await call("POST", "/api/rides", { as: ALICE, body: ride })).json.id;
  const put = (body: unknown) => call("PUT", `/api/rides/${id}/track`, { as: ALICE, body });
  assert.equal((await put({ track: { ...MERGED.track, w: [3001, 1, 1] }, stats: MERGED.stats })).status, 400);
  assert.equal((await put({ track: { ...MERGED.track, v: 3 }, stats: MERGED.stats })).status, 400);
  assert.equal((await put({ track: MERGED.track, stats: { ...MERGED.stats, hrZones: [1] } })).status, 400);
  assert.equal((await put({ track: MERGED.track })).status, 400);
  assert.equal((await put({ stats: MERGED.stats })).status, 400);
});
