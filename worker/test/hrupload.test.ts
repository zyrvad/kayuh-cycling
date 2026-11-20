import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { app, type Env } from "../src/index.ts";
import { encodePolyline } from "../src/polyline.ts";
import { testDb } from "./d1shim.ts";

const ALICE = "alice@example.com", BOB = "bob@example.com";
let env: Env;
const BASE = { operator: "helloride", capMinutes: 30, speedKmh: 13 };
const LINE = encodePolyline(Array.from({ length: 31 }, (_, i) => [103.8 + i * 0.001, 1.35] as [number, number]));
const STATS = { movingS: 900, elapsedS: 950, distanceM: 3000, avgKmh: 12, maxKmh: 20, stops: 0, stoppedS: 0, bests: { "1000": 300 } };
const ride = {
  name: "Coast", riddenAt: "2026-11-01T07:00:00.000Z", distanceM: 3000, timeS: 900, tierM: [3000, 0, 0, 0, 0, 0], polyline: LINE,
  source: "recorded", track: { v: 1, p: LINE, t: [0, 1, 1] }, stats: STATS,
};

async function call(method: string, path: string, opts: { as?: string; body?: unknown; raw?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.as) headers["X-Dev-Email"] = opts.as;
  const res = await app.request(path, { method, headers, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) }, env);
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

let id: string;
beforeEach(async () => {
  env = { DB: testDb(), DEV_AUTH: "1" };
  for (const as of [ALICE, BOB]) await call("PUT", "/api/me", { as, body: { ...BASE, displayName: as[0].toUpperCase() } });
  id = (await call("POST", "/api/rides", { as: ALICE, body: ride })).json.id;
});

const mint = async () => (await call("POST", `/api/rides/${id}/hr-token`, { as: ALICE })).json;
const line = (offS: number, bpm: number | string) => `${new Date(Date.parse(ride.riddenAt) + offS * 1000).toISOString()},${bpm}`;

test("only the owner mints a token; others get 404; the token is stored hashed", async () => {
  assert.equal((await call("POST", `/api/rides/${id}/hr-token`, { as: BOB })).status, 404);
  assert.equal((await call("POST", `/api/rides/${crypto.randomUUID()}/hr-token`, { as: ALICE })).status, 404);
  const t = await mint();
  assert.match(t.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(t.uploadUrl, `http://localhost/api/hr/${t.token}`);
  assert.equal(t.start, "2026-11-01T07:00:00.000Z");
  assert.equal(t.end, "2026-11-01T07:15:50.000Z");
  const rows = await env.DB.prepare("SELECT token_hash FROM hr_tokens").all<{ token_hash: string }>();
  assert.equal(rows.results.length, 1);
  assert.ok(!rows.results[0].token_hash.includes(t.token));
});

test("upload needs no identity; valid lines are kept, bad and out-of-window ones dropped", async () => {
  const t = await mint();
  const samples = [line(0, 120), line(10, 130), line(20, 24), line(30, 251), "garbage", line(40, "abc"), line(-601, 100), line(-300, 100), line(950 + 601, 100), line(960, 140), line(10, 131)].join("\n");
  const up = await call("POST", `/api/hr/${t.token}`, { body: { samples } });
  assert.equal(up.status, 200);
  assert.equal(up.json.accepted, 4);
  assert.deepEqual(Object.keys(up.json).sort(), ["accepted", "ok"], "no ride data comes back");
  const pending = (await call("GET", `/api/rides/${id}/hr-pending`, { as: ALICE })).json.samples;
  assert.deepEqual(pending.map((p: any) => p.bpm), [100, 120, 131, 140]);
});

test("list form is accepted too", async () => {
  const t = await mint();
  const up = await call("POST", `/api/hr/${t.token}`, { body: { samples: [{ t: line(0, 1).split(",")[0], bpm: 120 }, { t: "nope", bpm: 120 }] } });
  assert.equal(up.json.accepted, 1);
});

test("unknown and expired tokens are 404; nothing usable is 422; size cap is 413", async () => {
  assert.equal((await call("POST", "/api/hr/nope", { body: { samples: line(0, 100) } })).status, 404);
  const t = await mint();
  assert.equal((await call("POST", `/api/hr/${t.token}`, { body: { samples: "x,y" } })).status, 422);
  assert.equal((await call("POST", `/api/hr/${t.token}`, { raw: "not json" })).status, 400);
  assert.equal((await call("POST", `/api/hr/${t.token}`, { body: { samples: "a\n".repeat(50_001) } })).status, 400);
  assert.equal((await call("POST", `/api/hr/${t.token}`, { raw: JSON.stringify({ samples: "x".repeat(1_000_001) }) })).status, 413);
  await env.DB.prepare("UPDATE hr_tokens SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
  assert.equal((await call("POST", `/api/hr/${t.token}`, { body: { samples: line(0, 100) } })).status, 404);
});

test("pending samples: owner only to read and delete", async () => {
  const t = await mint();
  await call("POST", `/api/hr/${t.token}`, { body: { samples: line(0, 100) } });
  assert.deepEqual((await call("GET", `/api/rides/${id}/hr-pending`, { as: BOB })).json.samples, []);
  await call("DELETE", `/api/rides/${id}/hr-pending`, { as: BOB });
  assert.equal((await call("GET", `/api/rides/${id}/hr-pending`, { as: ALICE })).json.samples.length, 1);
  await call("DELETE", `/api/rides/${id}/hr-pending`, { as: ALICE });
  assert.equal((await call("GET", `/api/rides/${id}/hr-pending`, { as: ALICE })).json.samples.length, 0);
});

test("deleting the ride removes its token and pending samples", async () => {
  const t = await mint();
  await call("POST", `/api/hr/${t.token}`, { body: { samples: line(0, 100) } });
  await call("DELETE", `/api/rides/${id}`, { as: ALICE });
  assert.equal((await call("POST", `/api/hr/${t.token}`, { body: { samples: line(0, 100) } })).status, 404);
  assert.equal((await env.DB.prepare("SELECT 1 FROM ride_hr_pending").first()), null);
});

test("behind Access only /api/hr/:token is reachable without identity", async () => {
  const guarded: Env = { ...env, ACCESS_TEAM_DOMAIN: "x.cloudflareaccess.com", ACCESS_AUD: "aud" };
  const t = await mint();
  const hdr = { "Content-Type": "application/json" };
  const up = await app.request(`/api/hr/${t.token}`, { method: "POST", headers: hdr, body: JSON.stringify({ samples: line(0, 100) }) }, guarded);
  assert.equal(up.status, 200);
  for (const [m, p] of [["POST", `/api/rides/${id}/hr-token`], ["GET", `/api/rides/${id}/hr-pending`], ["DELETE", `/api/rides/${id}/hr-pending`]] as const) {
    const r = await app.request(p, { method: m, headers: hdr, body: m === "POST" ? "{}" : undefined }, guarded);
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});
