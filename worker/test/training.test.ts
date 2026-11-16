import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { app, type Env } from "../src/index.ts";
import { encodePolyline } from "../src/polyline.ts";
import { publicStats } from "../src/validate.ts";
import { testDb } from "./d1shim.ts";

const ALICE = "alice@example.com", BOB = "bob@example.com";
let env: Env;

beforeEach(async () => {
  env = { DB: testDb(), DEV_AUTH: "1" };
  for (const as of [ALICE, BOB]) await call("PUT", "/api/me", { as, body: { ...BASE, displayName: as[0].toUpperCase() + as.slice(1, as.indexOf("@")) } });
});

const BASE = { operator: "helloride", capMinutes: 30, speedKmh: 13 };

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
const STATS = {
  movingS: 900, elapsedS: 950, distanceM: 3000, avgKmh: 12, maxKmh: 20, stops: 0, stoppedS: 0, bests: { "1000": 300 },
  avgHr: 140, maxHr: 170, hrZones: [10, 200, 400, 250, 40], effort: 52, load: 52, avgPower: 150, maxPower: 400, np: 160, tss: 20,
  powerCurve: { "5": 400, "60": 250, "300": 200 },
};
const HEALTH = ["avgHr", "maxHr", "hrZones", "effort", "load", "avgPower", "maxPower", "np", "tss", "powerCurve"];
const TRACK_V2 = { v: 2, p: LINE, t: [0, 1, 1], h: [120, null, 130], c: [80, 82, null], w: [150, null, 300] };
const ride = (extra: object = {}) => ({
  name: "Coast", riddenAt: "2026-11-01T07:00:00.000Z", distanceM: 3000, timeS: 900, tierM: [3000, 0, 0, 0, 0, 0], polyline: LINE,
  source: "recorded", track: TRACK_V2, stats: STATS, rpe: 6, ...extra,
});
const noHealth = (o: any) => { for (const k of [...HEALTH, "rpe"]) assert.equal(k in o, false, `${k} leaked`); };

test("physiology round-trips, and absent fields keep their value", async () => {
  const body = { ...BASE, birthYear: 1990, maxHr: 188, restHr: 55, ftpW: 210, weightKg: 68.5 };
  assert.equal((await call("PUT", "/api/me", { as: ALICE, body })).status, 200);
  const me = (await call("GET", "/api/me", { as: ALICE })).json;
  assert.deepEqual([me.birthYear, me.maxHr, me.restHr, me.ftpW, me.weightKg], [1990, 188, 55, 210, 68.5]);
  // An older client that sends none of them changes nothing; null clears one.
  await call("PUT", "/api/me", { as: ALICE, body: BASE });
  assert.equal((await call("GET", "/api/me", { as: ALICE })).json.maxHr, 188);
  await call("PUT", "/api/me", { as: ALICE, body: { ...BASE, maxHr: null } });
  const after = (await call("GET", "/api/me", { as: ALICE })).json;
  assert.equal(after.maxHr, null);
  assert.equal(after.ftpW, 210);
  assert.equal((await call("GET", "/api/me", { as: BOB })).json.ftpW, null, "per user");
});

test("physiology ranges are enforced", async () => {
  const year = new Date().getUTCFullYear();
  for (const bad of [{ birthYear: 1919 }, { birthYear: year + 1 }, { maxHr: 119 }, { maxHr: 231 }, { restHr: 29 }, { restHr: 101 },
    { ftpW: 49 }, { ftpW: 601 }, { weightKg: 29 }, { weightKg: 201 }, { maxHr: 150.5 }, { ftpW: "200" }]) {
    assert.equal((await call("PUT", "/api/me", { as: ALICE, body: { ...BASE, ...bad } })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call("PUT", "/api/me", { as: ALICE, body: { ...BASE, birthYear: year, maxHr: 230, restHr: 30, ftpW: 600, weightKg: 200 } })).status, 200);
});

test("rpe: set at save, changed and cleared by the owner only", async () => {
  const id = (await call("POST", "/api/rides", { as: ALICE, body: ride() })).json.id;
  assert.equal((await call("GET", "/api/rides", { as: ALICE })).json.rides[0].rpe, 6);
  assert.equal((await call("GET", `/api/rides/${id}`, { as: ALICE })).json.ride.rpe, 6);
  assert.equal((await call("PUT", `/api/rides/${id}/effort`, { as: ALICE, body: { rpe: 8 } })).status, 200);
  assert.equal((await call("GET", `/api/rides/${id}`, { as: ALICE })).json.ride.rpe, 8);
  for (const bad of [0, 11, 5.5, "7"]) assert.equal((await call("PUT", `/api/rides/${id}/effort`, { as: ALICE, body: { rpe: bad } })).status, 400);
  assert.equal((await call("PUT", `/api/rides/${id}/effort`, { as: BOB, body: { rpe: 3 } })).status, 404, "not the owner");
  assert.equal((await call("GET", `/api/rides/${id}`, { as: ALICE })).json.ride.rpe, 8, "Bob changed nothing");
  await call("PUT", `/api/rides/${id}/effort`, { as: ALICE, body: { rpe: null } });
  assert.equal((await call("GET", `/api/rides/${id}`, { as: ALICE })).json.ride.rpe, null);
  assert.equal((await call("POST", "/api/rides", { as: ALICE, body: ride({ rpe: 11 }) })).status, 400);
});

test("track v2 is stored; v1 still works; bad sensor arrays are refused", async () => {
  const id = (await call("POST", "/api/rides", { as: ALICE, body: ride() })).json.id;
  const t = (await call("GET", `/api/rides/${id}`, { as: ALICE })).json.ride.track;
  assert.deepEqual([t.v, t.h, t.c, t.w], [2, [120, null, 130], [80, 82, null], [150, null, 300]]);
  assert.equal((await call("POST", "/api/rides", { as: ALICE, body: ride({ track: { v: 1, p: LINE, t: [0, 1], a: [1, 2] } }) })).status, 201);
  assert.equal((await call("POST", "/api/rides", { as: ALICE, body: ride({ track: { ...TRACK_V2, w: [3001, 1, 1] } }) })).status, 400);
  assert.equal((await call("POST", "/api/rides", { as: ALICE, body: ride({ track: { ...TRACK_V2, h: [-1, 1, 1] } }) })).status, 400);
  assert.equal((await call("POST", "/api/rides", { as: ALICE, body: ride({ track: { ...TRACK_V2, h: [1.5, 1, 1] } }) })).status, 400);
  assert.equal((await call("POST", "/api/rides", { as: ALICE, body: ride({ track: { ...TRACK_V2, v: 3 } }) })).status, 400);
  assert.equal((await call("POST", "/api/rides", { as: ALICE, body: ride({ stats: { ...STATS, hrZones: [1, 2] } }) })).status, 400);
  assert.equal((await call("POST", "/api/rides", { as: ALICE, body: ride({ stats: { ...STATS, avgHr: 999 } }) })).status, 400);
});

test("publicStats strips every health field and keeps the rest", () => {
  const out = publicStats({ ...STATS }) as Record<string, unknown>;
  noHealth(out);
  assert.equal(out.distanceM, 3000);
  assert.deepEqual(out.bests, { "1000": 300 });
  assert.equal(publicStats(null), null);
});

test("health data reaches the owner only: detail, feed and crew rides", async () => {
  const crew = (await call("POST", "/api/crews", { as: ALICE, body: { name: "A" } })).json;
  await call("POST", "/api/crews/join", { as: BOB, body: { code: crew.inviteCode } });
  const id = (await call("POST", "/api/rides", { as: ALICE, body: ride() })).json.id;
  await call("PUT", `/api/rides/${id}/sharing`, { as: ALICE, body: { crewIds: [crew.id], followers: false } });

  // Alice sees all of it everywhere.
  const mine = (await call("GET", `/api/rides/${id}`, { as: ALICE })).json.ride;
  assert.equal(mine.stats.avgHr, 140);
  assert.equal(mine.stats.powerCurve["60"], 250);
  const myFeed = (await call("GET", "/api/feed", { as: ALICE })).json.items.find((i: any) => i.id === id);
  assert.equal(myFeed.stats.effort, 52);

  // Bob sees the ride but none of it.
  const theirs = (await call("GET", `/api/rides/${id}`, { as: BOB })).json.ride;
  assert.equal(theirs.mine, false);
  noHealth(theirs);
  noHealth(theirs.stats);
  assert.equal(theirs.stats.distanceM, 3000);
  const feed = (await call("GET", "/api/feed", { as: BOB })).json.items.find((i: any) => i.id === id);
  noHealth(feed);
  noHealth(feed.stats);
  assert.equal(feed.stats.maxKmh, 20);
  const crewRides = (await call("GET", "/api/crew-rides", { as: BOB })).json.rides;
  assert.equal(crewRides.length, 1);
  noHealth(crewRides[0]);
  noHealth(crewRides[0].stats);
  const inCrew = (await call("GET", `/api/crews/${crew.id}/rides`, { as: BOB })).json.rides;
  assert.equal(inCrew.length, 1);
  noHealth(inCrew[0]);
  assert.equal(JSON.stringify(inCrew).includes("avgHr"), false);
});
