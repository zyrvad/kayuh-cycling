import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { requestEmail, resetKeyCache, verifyAccessJwt } from "../src/auth.ts";
import { app, type Env } from "../src/index.ts";
import { testDb } from "./d1shim.ts";

// ------------------------------------------------------------------ Access JWT

const DOMAIN = "kayuh-test.cloudflareaccess.com";
const AUD = "aud-123";

const b64url = (b: Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? b : b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function keyPair() {
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = { ...((await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey), kid: "k1" };
  return { kp, certs: async () => ({ keys: [jwk] }) };
}

async function sign(kp: CryptoKeyPair, payload: Record<string, unknown>, kid = "k1") {
  const head = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

const claims = (over: Record<string, unknown> = {}) => ({
  aud: [AUD], email: "Alice@Example.com", iss: `https://${DOMAIN}`, exp: Math.floor(Date.now() / 1000) + 600, ...over,
});

test("a valid Access token yields the (lower-cased) email", async () => {
  resetKeyCache();
  const { kp, certs } = await keyPair();
  assert.equal(await verifyAccessJwt(await sign(kp, claims()), DOMAIN, AUD, certs), "alice@example.com");
});

test("forged, expired and wrong-audience tokens are rejected", async () => {
  resetKeyCache();
  const { kp, certs } = await keyPair();
  const other = await keyPair();
  assert.equal(await verifyAccessJwt(await sign(other.kp, claims()), DOMAIN, AUD, certs), null, "signed by someone else");
  assert.equal(await verifyAccessJwt(await sign(kp, claims({ exp: 1000 })), DOMAIN, AUD, certs), null, "expired");
  assert.equal(await verifyAccessJwt(await sign(kp, claims({ aud: ["other"] })), DOMAIN, AUD, certs), null, "other app");
  assert.equal(await verifyAccessJwt(await sign(kp, claims({ iss: "https://evil.example" })), DOMAIN, AUD, certs), null, "other issuer");
  const valid = await sign(kp, claims());
  const tampered = valid.split(".");
  tampered[1] = b64url(JSON.stringify(claims({ email: "mallory@example.com" })));
  assert.equal(await verifyAccessJwt(tampered.join("."), DOMAIN, AUD, certs), null, "payload swapped");
});

test("the dev email header only works when DEV_AUTH is on", async () => {
  const req = new Request("http://x/api/me", { headers: { "X-Dev-Email": "bob@example.com" } });
  assert.equal(await requestEmail(req, {}), null);
  assert.equal(await requestEmail(req, { DEV_AUTH: "1" }), "bob@example.com");
});

// ------------------------------------------------------------------ crews end to end

const ALICE = "alice@example.com", BOB = "bob@example.com", CAROL = "carol@example.com";
const DEVICE = "33333333-3333-4333-8333-333333333333";
let env: Env;

beforeEach(() => {
  env = { DB: testDb(), DEV_AUTH: "1" };
});

async function call(method: string, path: string, opts: { as?: string; device?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.as) headers["X-Dev-Email"] = opts.as;
  if (opts.device) headers["X-Kayuh-Device"] = opts.device;
  const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* ics etc. */ }
  return { status: res.status, json, text };
}

const route = {
  name: "Coast to Changi", points: [[103.9135, 1.3016], [103.9876, 1.3893]],
  prefs: { speedKmh: 13, footpathAversion: 0.5, crossingAversion: 0.5 },
  distanceM: 17900, timeS: 7440, tierM: [13000, 500, 300, 3300, 800, 0], legs: 5, polyline: "_p~iF~ps|U",
};

test("crews need an account; a device alone gets a sign-in prompt", async () => {
  const r = await call("GET", "/api/crews", { device: DEVICE });
  assert.equal(r.status, 401);
  assert.equal(r.json.signIn, true);
});

test("signing in moves a device's saved routes to the account", async () => {
  await call("POST", "/api/routes", { device: DEVICE, body: { ...route, mode: "ab", profile: "nicest" } });
  const me = await call("GET", "/api/me", { as: ALICE, device: DEVICE });
  assert.equal(me.json.signedIn, true);
  assert.equal(me.json.email, ALICE);
  assert.equal((await call("GET", "/api/routes", { as: ALICE })).json.routes.length, 1, "route followed the account");
});

test("create a crew, invite a friend, plan a group ride and RSVP", async () => {
  const crew = (await call("POST", "/api/crews", { as: ALICE, body: { name: "Sunday Kakis" } })).json;
  assert.match(crew.inviteCode, /^[A-Z0-9]{8}$/);

  // Bob's on Anywheel with a 20-minute cap; Alice keeps the 30-minute default.
  await call("PUT", "/api/me", { as: BOB, body: { operator: "anywheel", capMinutes: 20, speedKmh: 13, displayName: "Bob" } });
  assert.equal((await call("POST", "/api/crews/join", { as: BOB, body: { code: crew.inviteCode.toLowerCase() } })).status, 200);
  assert.equal((await call("GET", `/api/crews/${crew.id}`, { as: CAROL })).status, 404, "outsiders can't see the crew");

  const detail = (await call("GET", `/api/crews/${crew.id}`, { as: BOB })).json;
  assert.deepEqual(detail.members.map((m: any) => [m.name, m.role]), [["alice", "owner"], ["Bob", "member"]]);

  const startsAt = new Date(Date.now() + 2 * 86400_000).toISOString();
  const ride = (await call("POST", `/api/crews/${crew.id}/group-rides`, {
    as: ALICE,
    body: { title: "Coast ride", startsAt, notes: "Bring water", meet: { lon: 103.9135, lat: 1.3016, name: "Marine Cove" }, route },
  })).json;
  assert.equal((await call("PUT", `/api/group-rides/${ride.id}/rsvp`, { as: BOB, body: { status: "going" } })).status, 200);

  const g = (await call("GET", `/api/group-rides/${ride.id}`, { as: ALICE })).json;
  assert.equal(g.people.filter((p: any) => p.status === "going").length, 2);
  assert.equal(g.strictestCapMinutes, 20, "the route must fit Bob's shorter free ride");
  assert.equal(g.canDelete, true);
  assert.equal((await call("GET", `/api/group-rides/${ride.id}`, { as: BOB })).json.canDelete, false);

  const upcoming = (await call("GET", "/api/group-rides", { as: BOB })).json.rides;
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].myStatus, "going");
  assert.equal(upcoming[0].going, 2);

  const cal = await call("GET", `/api/group-rides/${ride.id}/ics`, { as: BOB });
  assert.match(cal.text, /BEGIN:VEVENT/);
  assert.match(cal.text, /LOCATION:Marine Cove/);

  assert.equal((await call("DELETE", `/api/group-rides/${ride.id}`, { as: BOB })).status, 404, "only the planner or owner deletes");
  assert.equal((await call("DELETE", `/api/group-rides/${ride.id}`, { as: ALICE })).status, 200);
});

test("crewmates see only rides shared with the crew", async () => {
  const crew = (await call("POST", "/api/crews", { as: ALICE, body: { name: "Kakis" } })).json;
  await call("POST", "/api/crews/join", { as: BOB, body: { code: crew.inviteCode } });
  const ride = { name: "Bob's ride", riddenAt: "2026-10-20T07:00:00+08:00", distanceM: 9000, timeS: 2400, tierM: route.tierM, polyline: route.polyline, source: "planned" };
  const priv = (await call("POST", "/api/rides", { as: BOB, body: ride })).json;
  const shared = (await call("POST", "/api/rides", { as: BOB, body: { ...ride, name: "Shared one" } })).json;
  await call("PATCH", `/api/rides/${shared.id}`, { as: BOB, body: { visibility: "crew" } });
  const feed = (await call("GET", `/api/crews/${crew.id}/rides`, { as: ALICE })).json.rides;
  assert.deepEqual(feed.map((r: any) => r.name), ["Shared one"]);
  assert.ok(priv.id);
});

test("rotating the invite kills the old link; the last member leaving deletes the crew", async () => {
  const crew = (await call("POST", "/api/crews", { as: ALICE, body: { name: "Kakis" } })).json;
  const fresh = (await call("POST", `/api/crews/${crew.id}/invite`, { as: ALICE })).json.inviteCode;
  assert.equal((await call("POST", "/api/crews/join", { as: BOB, body: { code: crew.inviteCode } })).status, 404);
  assert.equal((await call("POST", "/api/crews/join", { as: BOB, body: { code: fresh } })).status, 200);

  await call("DELETE", `/api/crews/${crew.id}/members/me`, { as: ALICE });
  const bobView = (await call("GET", `/api/crews/${crew.id}`, { as: BOB })).json;
  assert.equal(bobView.role, "owner", "ownership passes on");
  await call("DELETE", `/api/crews/${crew.id}/members/me`, { as: BOB });
  assert.equal((await call("GET", "/api/crews", { as: BOB })).json.crews.length, 0);
});

test("share a saved route with the crew; only crewmates see it and the sharer or owner can remove it", async () => {
  const crew = (await call("POST", "/api/crews", { as: ALICE, body: { name: "Kakis" } })).json;
  await call("POST", "/api/crews/join", { as: BOB, body: { code: crew.inviteCode } });
  await call("POST", "/api/crews/join", { as: CAROL, body: { code: crew.inviteCode } });
  const saved = (await call("POST", "/api/routes", { as: BOB, body: { ...route, mode: "ab", profile: "nicest" } })).json;
  const alices = (await call("POST", "/api/routes", { as: ALICE, body: { ...route, mode: "ab", profile: "nicest" } })).json;

  assert.equal((await call("POST", `/api/crews/${crew.id}/routes`, { as: BOB, body: { routeId: alices.id } })).status, 404, "can't share someone else's route");
  assert.equal((await call("POST", `/api/crews/${crew.id}/routes`, { as: BOB, body: { routeId: "nope" } })).status, 400);
  assert.equal((await call("POST", `/api/crews/${crew.id}/routes`, { as: BOB, body: { routeId: saved.id, note: "Sunset ride?" } })).status, 201);
  assert.equal((await call("POST", `/api/crews/${crew.id}/routes`, { as: BOB, body: { routeId: saved.id } })).status, 201, "sharing twice is fine");

  const seen = (await call("GET", `/api/crews/${crew.id}/routes`, { as: ALICE })).json.routes;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "Coast to Changi");
  assert.deepEqual(seen[0].points, route.points);
  assert.equal(seen[0].canRemove, true, "Alice owns the crew");
  assert.equal((await call("GET", `/api/crews/${crew.id}/routes`, { as: CAROL })).json.routes[0].canRemove, false);
  assert.equal((await call("GET", `/api/crews/${crew.id}/routes`, { as: "dave@example.com" })).status, 404, "outsiders can't see it");

  assert.equal((await call("DELETE", `/api/crews/${crew.id}/routes/${saved.id}`, { as: CAROL })).status, 404);
  assert.equal((await call("DELETE", `/api/crews/${crew.id}/routes/${saved.id}`, { as: ALICE })).status, 200);
  assert.equal((await call("GET", `/api/crews/${crew.id}/routes`, { as: BOB })).json.routes.length, 0);

  // Deleting the saved route removes it from the crew too.
  await call("POST", `/api/crews/${crew.id}/routes`, { as: BOB, body: { routeId: saved.id } });
  await call("DELETE", `/api/routes/${saved.id}`, { as: BOB });
  assert.equal((await call("GET", `/api/crews/${crew.id}/routes`, { as: ALICE })).json.routes.length, 0);
});

test("profile pictures: only accounts upload, only crewmates see them, and they must really be images", async () => {
  // Smallest valid JPEG header bytes are enough for the magic-number check.
  const jpeg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString("base64");
  const html = "data:image/jpeg;base64," + Buffer.from("<html><script>alert(1)</script>").toString("base64");

  assert.equal((await call("PUT", "/api/me/avatar", { device: DEVICE, body: { image: jpeg } })).status, 401, "devices can't");
  assert.equal((await call("PUT", "/api/me/avatar", { as: ALICE, body: { image: html } })).status, 400, "HTML labelled as JPEG");
  assert.equal((await call("PUT", "/api/me/avatar", { as: ALICE, body: { image: "data:image/svg+xml;base64,PHN2Zz4=" } })).status, 400, "no SVG");
  const put = await call("PUT", "/api/me/avatar", { as: ALICE, body: { image: jpeg } });
  assert.equal(put.status, 200);
  const url = put.json.avatar as string;
  assert.match(url, /^\/api\/avatars\/[0-9a-f-]+\?v=/);
  assert.equal((await call("GET", "/api/me", { as: ALICE })).json.avatar, url);

  const img = await app.request(url, { headers: { "X-Dev-Email": ALICE } }, env);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("Content-Type"), "image/jpeg");
  assert.equal(new Uint8Array(await img.arrayBuffer())[0], 0xff);
  assert.equal((await app.request(url, { headers: { "X-Dev-Email": BOB } }, env)).status, 404, "strangers can't");

  const crew = (await call("POST", "/api/crews", { as: ALICE, body: { name: "Kakis" } })).json;
  await call("POST", "/api/crews/join", { as: BOB, body: { code: crew.inviteCode } });
  assert.equal((await app.request(url, { headers: { "X-Dev-Email": BOB } }, env)).status, 200, "crewmates can");
  const members = (await call("GET", `/api/crews/${crew.id}`, { as: BOB })).json.members;
  assert.equal(members.find((m: any) => m.name === "alice").avatar, url);
  assert.equal(members.find((m: any) => m.name === "bob").avatar, null);

  assert.equal((await call("DELETE", "/api/me/avatar", { as: ALICE })).status, 200);
  assert.equal((await call("GET", "/api/me", { as: ALICE })).json.avatar, null);
});
