import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { app, SECURITY_HEADERS, type Env } from "../src/index.ts";
import { decodePolyline, encodePolyline, trimEnds } from "../src/polyline.ts";
import { testDb } from "./d1shim.ts";

const DEVICE = "55555555-5555-4555-8555-555555555555";
const route = {
  name: "r", mode: "ab", profile: "nicest", points: [[103.9135, 1.3016], [103.9876, 1.3893]],
  prefs: { speedKmh: 13, footpathAversion: 0.5, crossingAversion: 0.5 },
  distanceM: 1, timeS: 1, tierM: [1, 0, 0, 0, 0, 0], legs: 1, polyline: "ab",
};

async function req(env: Env, method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
}

test("behind Access, requests without a valid Access token are refused (fail closed)", async () => {
  const env: Env = { DB: testDb(), ACCESS_TEAM_DOMAIN: "x.cloudflareaccess.com", ACCESS_AUD: "aud", DEV_AUTH: "1" };
  const deviceOnly = await req(env, "GET", "/api/routes", { "X-Kayuh-Device": DEVICE });
  assert.equal(deviceOnly.status, 401);
  // Even with DEV_AUTH set by mistake, the dev header must not work once Access is configured.
  const devHeader = await req(env, "GET", "/api/me", { "X-Kayuh-Device": DEVICE, "X-Dev-Email": "evil@example.com" });
  assert.equal(devHeader.status, 401);
  const forged = await req(env, "GET", "/api/me", { "Cf-Access-Jwt-Assertion": "a.b.c" });
  assert.equal(forged.status, 401);
});

test("without Access configured (local dev), device ids still work", async () => {
  const env: Env = { DB: testDb() };
  assert.equal((await req(env, "GET", "/api/routes", { "X-Kayuh-Device": DEVICE })).status, 200);
});

test("cross-site and non-JSON writes are blocked", async () => {
  const env: Env = { DB: testDb() };
  const h = { "X-Kayuh-Device": DEVICE, "Content-Type": "application/json" };
  const evil = await req(env, "POST", "http://localhost/api/routes", { ...h, Origin: "https://evil.example" }, route);
  assert.equal(evil.status, 403);
  const formLike = await req(env, "POST", "http://localhost/api/routes", { "X-Kayuh-Device": DEVICE, "Content-Type": "text/plain" }, route);
  assert.equal(formLike.status, 415);
  const same = await req(env, "POST", "http://localhost/api/routes", { ...h, Origin: "http://localhost" }, route);
  assert.equal(same.status, 201);
  // Reads are unaffected.
  assert.equal((await req(env, "GET", "http://localhost/api/routes", { "X-Kayuh-Device": DEVICE, Origin: "https://evil.example" })).status, 200);
});

test("every response carries the security headers", async () => {
  const env: Env = { DB: testDb() };
  const res = await worker.fetch(new Request("http://localhost/api/health"), env, {} as ExecutionContext);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(k), v, k);
  assert.match(res.headers.get("Content-Security-Policy")!, /frame-ancestors 'none'/);
});

test("shared rides lose their first and last 200 m", () => {
  // ~1.1 km due east along the equator-ish line at SG latitude.
  const line: [number, number][] = [];
  for (let i = 0; i <= 10; i++) line.push([103.8 + i * 0.001, 1.3]);
  const trimmed = decodePolyline(trimEnds(encodePolyline(line)));
  const startShift = (trimmed[0][0] - 103.8) * 111320;
  const endShift = (103.81 - trimmed[trimmed.length - 1][0]) * 111320;
  assert.ok(Math.abs(startShift - 200) < 5, `start moved ${startShift} m`);
  assert.ok(Math.abs(endShift - 200) < 5, `end moved ${endShift} m`);
  // A ride shorter than 400 m shows no line at all.
  assert.equal(trimEnds(encodePolyline([[103.8, 1.3], [103.802, 1.3]])), "");
  assert.equal(typeof trimEnds("not a polyline"), "string", "garbage never throws");
});

test("calendar files can't be injected through ride titles", async () => {
  const env: Env = { DB: testDb(), DEV_AUTH: "1" };
  const h = { "X-Dev-Email": "a@example.com", "Content-Type": "application/json" };
  const crew = await (await req(env, "POST", "/api/crews", h, { name: "c" })).json() as { id: string };
  const ride = await (await req(env, "POST", `/api/crews/${crew.id}/group-rides`, h, {
    title: "Ride\r\nATTENDEE:mailto:x@evil.example", startsAt: new Date(Date.now() + 86400_000).toISOString(),
    meet: { lon: 103.9, lat: 1.3, name: "Here\nX-INJECTED:1" },
    route: { ...route, polyline: "_p~iF~ps|U" },
  })).json() as { id: string };
  const ics = await (await req(env, "GET", `/api/group-rides/${ride.id}/ics`, h)).text();
  const lines = ics.split("\r\n");
  assert.ok(!lines.some((l) => l.startsWith("ATTENDEE") || l.startsWith("X-INJECTED")), ics);
});
