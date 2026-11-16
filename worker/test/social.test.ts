import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { app, type Env } from "../src/index.ts";
import { encodePolyline, trimEnds } from "../src/polyline.ts";
import { testDb } from "./d1shim.ts";

const ALICE = "alice@example.com", BOB = "bob@example.com", CAROL = "carol@example.com", DAVE = "dave@example.com", ERIN = "erin@example.com";
const DEVICE = "33333333-3333-4333-8333-333333333333";
let env: Env;

beforeEach(async () => {
  env = { DB: testDb(), DEV_AUTH: "1" };
  // New accounts have no display name (see "a new account has no name"); these riders chose one.
  for (const as of [ALICE, BOB, CAROL, DAVE, ERIN]) await named(as, as[0].toUpperCase() + as.slice(1, as.indexOf("@")));
});

const named = (as: string, displayName: string) =>
  call("PUT", "/api/me", { as, body: { operator: "helloride", capMinutes: 30, speedKmh: 13, displayName } });

async function call(method: string, path: string, opts: { as?: string; device?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.as) headers["X-Dev-Email"] = opts.as;
  if (opts.device) headers["X-Kayuh-Device"] = opts.device;
  const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

// About 3 km along a straight line, so the 200 m privacy trim visibly changes it.
const LINE = encodePolyline(Array.from({ length: 31 }, (_, i) => [103.8 + i * 0.001, 1.35] as [number, number]));
const TRACK = { v: 1, p: LINE, t: [0, 1, 1], a: [12, null, 13], s: [150, 162, -1], k: "00-", L: [0] };
const ride = (name: string, riddenAt = "2026-11-01T07:00:00.000Z") => ({
  name, riddenAt, distanceM: 3000, timeS: 900, tierM: [3000, 0, 0, 0, 0, 0], polyline: LINE, source: "recorded", track: TRACK,
});

const newCrew = async (as: string, name: string) => (await call("POST", "/api/crews", { as, body: { name } })).json as { id: string; inviteCode: string };
const join = (as: string, code: string) => call("POST", "/api/crews/join", { as, body: { code } });
const logRide = async (as: string, name: string, riddenAt?: string) => (await call("POST", "/api/rides", { as, body: ride(name, riddenAt) })).json.id as string;
const share = (as: string, id: string, crewIds: string[], followers = false) => call("PUT", `/api/rides/${id}/sharing`, { as, body: { crewIds, followers } });
const sees = async (as: string, id: string) => (await call("GET", `/api/rides/${id}`, { as })).status === 200;
const feedIds = async (as: string) => ((await call("GET", "/api/feed", { as })).json.items as any[]).map((i) => i.id);
const codeOf = async (as: string) => (await call("GET", "/api/me/follow", { as })).json.code as string;

test("social endpoints need an account", async () => {
  for (const [m, p] of [["GET", "/api/feed"], ["GET", "/api/me/follow"], ["POST", "/api/follow"]] as const) {
    const r = await call(m, p, { device: DEVICE, body: m === "POST" ? { code: "ABCDEFGH" } : undefined });
    assert.equal(r.status, 401, p);
    assert.equal(r.json.signIn, true);
  }
});

test("a ride shared with crew A reaches crew A only", async () => {
  const a = await newCrew(ALICE, "A"), b = await newCrew(ALICE, "B"), other = await newCrew(DAVE, "Dave's");
  await join(BOB, a.inviteCode);
  await join(CAROL, b.inviteCode);
  const id = await logRide(ALICE, "Coast");

  assert.equal((await share(ALICE, id, [other.id])).status, 400, "not a crew Alice is in");
  assert.equal((await share(BOB, id, [a.id])).status, 404, "not Bob's ride");
  assert.equal((await call("GET", `/api/rides/${id}/sharing`, { as: BOB })).status, 404);
  const put = await share(ALICE, id, [a.id]);
  assert.deepEqual(put.json, { crewIds: [a.id], followers: false });
  assert.deepEqual((await call("GET", `/api/rides/${id}/sharing`, { as: ALICE })).json, { crewIds: [a.id], followers: false });

  const mine = (await call("GET", "/api/rides", { as: ALICE })).json.rides[0];
  assert.deepEqual(mine.sharedCrewIds, [a.id]);
  assert.equal(mine.shareFollowers, false);
  assert.equal(mine.visibility, "crew");

  assert.equal(await sees(BOB, id), true);
  assert.equal(await sees(CAROL, id), false, "crew B never sees it");
  assert.equal(await sees(DAVE, id), false);
  assert.deepEqual((await call("GET", `/api/crews/${a.id}/rides`, { as: BOB })).json.rides.map((r: any) => r.id), [id]);
  assert.deepEqual((await call("GET", `/api/crews/${b.id}/rides`, { as: CAROL })).json.rides, []);
  assert.deepEqual((await call("GET", "/api/crew-rides", { as: CAROL })).json.rides, []);
  assert.deepEqual((await call("GET", "/api/crew-rides", { as: BOB })).json.rides.map((r: any) => r.id), [id]);
  assert.deepEqual(await feedIds(BOB), [id]);
  assert.deepEqual(await feedIds(CAROL), []);
  const item = (await call("GET", "/api/feed", { as: BOB })).json.items[0];
  assert.deepEqual(item.crews, [{ id: a.id, name: "A" }], "only crews the viewer is in");

  // Un-sharing takes it away again.
  await share(ALICE, id, []);
  assert.equal(await sees(BOB, id), false);
  assert.equal((await call("GET", "/api/rides", { as: ALICE })).json.rides[0].visibility, "private");

  // The old switch still means "all my crews".
  await call("PATCH", `/api/rides/${id}`, { as: ALICE, body: { visibility: "crew" } });
  assert.equal(await sees(BOB, id), true);
  assert.equal(await sees(CAROL, id), true);
  await call("PATCH", `/api/rides/${id}`, { as: ALICE, body: { visibility: "private" } });
  assert.equal(await sees(BOB, id), false);
});

test("rides shared before per-crew sharing keep reaching all the rider's crews", async () => {
  env = {
    DEV_AUTH: "1",
    DB: testDb({
      seedBefore: "0007",
      seed: (db) => db.exec(`
        INSERT INTO users (id, kind, email, display_name) VALUES
          ('u-alice', 'account', '${ALICE}', 'Alice'), ('u-bob', 'account', '${BOB}', 'Bob'), ('u-carol', 'account', '${CAROL}', 'Carol'),
          ('u-dave', 'account', '${DAVE}', 'dave');
        INSERT INTO crews (id, name, invite_code, created_by) VALUES ('c-1', 'One', 'AAAAAAAA', 'u-alice'), ('c-2', 'Two', 'BBBBBBBB', 'u-alice');
        INSERT INTO crew_members (crew_id, user_id, role) VALUES ('c-1', 'u-alice', 'owner'), ('c-2', 'u-alice', 'owner'), ('c-1', 'u-bob', 'member');
        INSERT INTO rides (id, user_id, name, ridden_at, distance_m, time_s, tier_m, polyline, source, visibility) VALUES
          ('r-shared', 'u-alice', 'Old shared', '2026-10-01T07:00:00Z', 3000, 900, '[3000,0,0,0,0,0]', '${LINE}', 'planned', 'crew'),
          ('r-private', 'u-alice', 'Old private', '2026-10-02T07:00:00+08:00', 3000, 900, '[3000,0,0,0,0,0]', '${LINE}', 'planned', 'private');
      `),
    }),
  };
  assert.deepEqual((await call("GET", "/api/rides/r-shared/sharing", { as: ALICE })).json, { crewIds: ["c-1", "c-2"], followers: false });
  assert.deepEqual((await call("GET", "/api/rides/r-private/sharing", { as: ALICE })).json, { crewIds: [], followers: false });
  assert.equal(await sees(BOB, "r-shared"), true);
  assert.equal(await sees(BOB, "r-private"), false);
  assert.equal(await sees(CAROL, "r-shared"), false);
  // Names that were just the email's name part are cleared; chosen ones stay.
  assert.equal((await call("GET", "/api/me", { as: DAVE })).json.displayName, null);
  assert.equal((await call("GET", "/api/me", { as: BOB })).json.displayName, "Bob");
  // Ride times become ISO UTC.
  assert.deepEqual((await call("GET", "/api/rides", { as: ALICE })).json.rides.map((r: any) => r.riddenAt),
    ["2026-10-01T07:00:00.000Z", "2026-10-01T23:00:00.000Z"].reverse());
});

test("private accounts: a pending follower sees nothing; once accepted, only followers-shared rides", async () => {
  const crew = await newCrew(ALICE, "Kakis");
  const forFollowers = await logRide(ALICE, "For followers");
  const crewOnly = await logRide(ALICE, "Crew only", "2026-11-02T07:00:00.000Z");
  await share(ALICE, forFollowers, [], true);
  await share(ALICE, crewOnly, [crew.id]);
  const code = await codeOf(ALICE);
  assert.match(code, /^[A-Z0-9]{8}$/);
  assert.equal(await codeOf(ALICE), code, "the code stays put until rotated");

  assert.equal((await call("POST", "/api/follow", { as: ALICE, body: { code } })).status, 400, "can't follow yourself");
  const f = await call("POST", "/api/follow", { as: CAROL, body: { code: code.toLowerCase() } });
  assert.deepEqual(f.json, { status: "pending", user: { id: f.json.user.id, name: "Alice" } });
  assert.equal((await call("POST", "/api/follow", { as: CAROL, body: { code } })).json.status, "pending", "idempotent");

  assert.equal(await sees(CAROL, forFollowers), false, "pending sees nothing");
  assert.deepEqual(await feedIds(CAROL), []);
  assert.equal((await call("POST", `/api/rides/${forFollowers}/kudos`, { as: CAROL })).status, 404);

  const alice = (await call("GET", "/api/me/follow", { as: ALICE })).json;
  assert.equal(alice.privateAccount, true, "private by default");
  assert.deepEqual(alice.requests.map((p: any) => p.name), ["Carol"]);
  const carol = (await call("GET", "/api/me/follow", { as: CAROL })).json;
  assert.deepEqual(carol.outgoing.map((p: any) => p.name), ["Alice"]);
  assert.deepEqual(carol.following, []);

  assert.equal((await call("POST", `/api/follow/requests/${alice.requests[0].id}/accept`, { as: BOB })).status, 404, "only Alice can accept");
  assert.equal((await call("POST", `/api/follow/requests/${alice.requests[0].id}/accept`, { as: ALICE })).status, 200);
  assert.equal(await sees(CAROL, forFollowers), true);
  assert.equal(await sees(CAROL, crewOnly), false, "crew-only stays with the crew");
  assert.deepEqual(await feedIds(CAROL), [forFollowers]);
  assert.deepEqual((await call("GET", "/api/me/follow", { as: ALICE })).json.followers.map((p: any) => p.name), ["Carol"]);
  assert.deepEqual((await call("GET", "/api/me/follow", { as: CAROL })).json.following.map((p: any) => p.name), ["Alice"]);

  // A rotated code stops working for new followers; existing ones stay.
  const fresh = (await call("POST", "/api/me/follow/code", { as: ALICE })).json.code;
  assert.notEqual(fresh, code);
  assert.equal((await call("POST", "/api/follow", { as: DAVE, body: { code } })).status, 404);
  assert.equal(await sees(CAROL, forFollowers), true);

  // Declining a request.
  await call("POST", "/api/follow", { as: DAVE, body: { code: fresh } });
  const daveId = (await call("GET", "/api/me/follow", { as: ALICE })).json.requests[0].id;
  assert.equal((await call("DELETE", `/api/follow/requests/${daveId}`, { as: ALICE })).status, 200);
  assert.deepEqual((await call("GET", "/api/me/follow", { as: DAVE })).json.outgoing, []);
});

test("public accounts are followed at once, and going public accepts everyone waiting", async () => {
  const id = await logRide(ALICE, "Open ride");
  await share(ALICE, id, [], true);
  const code = await codeOf(ALICE);
  await call("POST", "/api/follow", { as: DAVE, body: { code } });
  assert.equal(await sees(DAVE, id), false);
  assert.equal((await call("PUT", "/api/me/follow", { as: ALICE, body: { privateAccount: "no" } })).status, 400);
  assert.deepEqual((await call("PUT", "/api/me/follow", { as: ALICE, body: { privateAccount: false } })).json, { privateAccount: false });
  assert.equal(await sees(DAVE, id), true, "Dave's request was accepted");
  assert.deepEqual((await call("POST", "/api/follow", { as: ERIN, body: { code } })).json.status, "accepted");
  assert.equal(await sees(ERIN, id), true);
  const info = (await call("GET", "/api/me/follow", { as: ALICE })).json;
  assert.deepEqual(info.requests, []);
  assert.deepEqual(info.followers.map((p: any) => p.name).sort(), ["Dave", "Erin"]);

  // Going private again keeps the followers you already have (only new ones need approval).
  await call("PUT", "/api/me/follow", { as: ALICE, body: { privateAccount: true } });
  assert.equal(await sees(DAVE, id), true);
  assert.equal((await call("POST", "/api/follow", { as: CAROL, body: { code } })).json.status, "pending");
});

test("unfollowing or removing a follower revokes access", async () => {
  await call("PUT", "/api/me/follow", { as: ALICE, body: { privateAccount: false } });
  const id = await logRide(ALICE, "Open ride");
  await share(ALICE, id, [], true);
  const code = await codeOf(ALICE);
  const { user } = (await call("POST", "/api/follow", { as: CAROL, body: { code } })).json;
  assert.equal(await sees(CAROL, id), true);
  assert.equal((await call("DELETE", `/api/following/${user.id}`, { as: CAROL })).status, 200);
  assert.equal(await sees(CAROL, id), false);

  await call("POST", "/api/follow", { as: CAROL, body: { code } });
  const carolId = (await call("GET", "/api/me/follow", { as: ALICE })).json.followers[0].id;
  assert.equal((await call("DELETE", `/api/followers/${carolId}`, { as: ALICE })).status, 200);
  assert.equal(await sees(CAROL, id), false);
  assert.deepEqual(await feedIds(CAROL), []);

  // Switching followers off on the ride works too.
  await call("POST", "/api/follow", { as: CAROL, body: { code } });
  assert.equal(await sees(CAROL, id), true);
  await share(ALICE, id, [], false);
  assert.equal(await sees(CAROL, id), false);
});

test("others never get the GPS track, and their line is trimmed 200 m at each end", async () => {
  const crew = await newCrew(ALICE, "Kakis");
  await join(BOB, crew.inviteCode);
  const id = await logRide(ALICE, "Coast");
  await share(ALICE, id, [crew.id]);

  const own = (await call("GET", `/api/rides/${id}`, { as: ALICE })).json.ride;
  assert.equal(own.mine, true);
  assert.equal(own.polyline, LINE);
  assert.deepEqual(own.track.t, [0, 1, 1]);

  const theirs = (await call("GET", `/api/rides/${id}`, { as: BOB })).json.ride;
  assert.equal(theirs.mine, false);
  assert.equal("track" in theirs, false, "no track key at all");
  assert.equal(theirs.hasTrack, false);
  assert.equal(theirs.sharedCrewIds, undefined, "who else it's shared with stays private");
  for (const k of ["source", "visibility", "predictedS", "routeId"]) assert.equal(k in theirs, false, `no ${k} for others`);
  for (const k of ["source", "visibility", "predictedS", "routeId"]) assert.equal(k in own, true, `${k} for the rider`);
  assert.equal(theirs.polyline, trimEnds(LINE));
  assert.notEqual(theirs.polyline, LINE);
  assert.ok(theirs.polyline.length > 0);
  assert.deepEqual(theirs.rider, { id: own.rider.id, name: "Alice", avatar: null });

  const item = (await call("GET", "/api/feed", { as: BOB })).json.items[0];
  assert.equal(item.polyline, trimEnds(LINE));
  assert.equal(item.track, undefined);
  assert.equal((await call("GET", "/api/feed", { as: ALICE })).json.items[0].polyline, LINE, "your own feed item is whole");
});

test("kudos and comments only on rides you can see; comments deleted by author or rider", async () => {
  const crew = await newCrew(ALICE, "Kakis");
  await join(BOB, crew.inviteCode);
  await join(CAROL, crew.inviteCode);
  const id = await logRide(ALICE, "Coast");
  const hidden = await logRide(ALICE, "Private");
  await share(ALICE, id, [crew.id]);

  assert.equal((await call("POST", `/api/rides/${hidden}/kudos`, { as: BOB })).status, 404);
  assert.equal((await call("GET", `/api/rides/${hidden}/comments`, { as: BOB })).status, 404);
  assert.equal((await call("POST", `/api/rides/${hidden}/comments`, { as: BOB, body: { body: "hi" } })).status, 404);
  assert.equal((await call("POST", `/api/rides/${id}/kudos`, { as: DAVE })).status, 404);
  assert.equal((await call("GET", `/api/rides/${id}/comments`, { as: DAVE })).status, 404);
  assert.equal((await call("POST", `/api/rides/${id}/comments`, { as: DAVE, body: { body: "hi" } })).status, 404);

  assert.equal((await call("POST", `/api/rides/${id}/kudos`, { as: ALICE })).status, 400, "not on your own ride");
  assert.deepEqual((await call("POST", `/api/rides/${id}/kudos`, { as: BOB })).json, { kudos: 1, kudoed: true });
  assert.deepEqual((await call("POST", `/api/rides/${id}/kudos`, { as: BOB })).json, { kudos: 1, kudoed: true }, "idempotent");
  assert.deepEqual((await call("POST", `/api/rides/${id}/kudos`, { as: CAROL })).json, { kudos: 2, kudoed: true });
  assert.deepEqual((await call("DELETE", `/api/rides/${id}/kudos`, { as: CAROL })).json, { kudos: 1, kudoed: false });

  assert.equal((await call("POST", `/api/rides/${id}/comments`, { as: BOB, body: { body: "   " } })).status, 400);
  assert.equal((await call("POST", `/api/rides/${id}/comments`, { as: BOB, body: { body: "x".repeat(501) } })).status, 400);
  const bobs = await call("POST", `/api/rides/${id}/comments`, { as: BOB, body: { body: "  Nice one!  " } });
  assert.equal(bobs.status, 201);
  assert.equal(bobs.json.comment.body, "Nice one!");
  const carols = (await call("POST", `/api/rides/${id}/comments`, { as: CAROL, body: { body: "Same route next week?" } })).json.comment;
  const third = (await call("POST", `/api/rides/${id}/comments`, { as: CAROL, body: { body: "One more" } })).json.comment;

  const asBob = (await call("GET", `/api/rides/${id}/comments`, { as: BOB })).json.comments;
  assert.deepEqual(asBob.map((k: any) => [k.author.name, k.mine, k.canDelete]), [["Bob", true, true], ["Carol", false, false], ["Carol", false, false]]);
  assert.deepEqual((await call("GET", `/api/rides/${id}/comments`, { as: ALICE })).json.comments.map((k: any) => k.canDelete), [true, true, true]);

  assert.equal((await call("DELETE", `/api/comments/${carols.id}`, { as: BOB })).status, 404, "not someone else's");
  assert.equal((await call("DELETE", `/api/comments/${carols.id}`, { as: DAVE })).status, 404);
  assert.equal((await call("DELETE", `/api/comments/${carols.id}`, { as: ALICE })).status, 200, "the rider can");
  assert.equal((await call("DELETE", `/api/comments/${bobs.json.comment.id}`, { as: BOB })).status, 200, "the author can");
  assert.equal((await call("DELETE", `/api/comments/${third.id}`, { as: CAROL })).status, 200);

  const detail = (await call("GET", `/api/rides/${id}`, { as: BOB })).json.ride;
  assert.deepEqual([detail.kudos, detail.kudoed, detail.comments], [1, true, 0]);
  assert.equal((await call("DELETE", `/api/rides/${id}`, { as: ALICE })).status, 200, "a ride with kudos deletes cleanly");
});

test("the feed has your rides and rides you may see, newest first, a page at a time", async () => {
  const crew = await newCrew(ALICE, "Kakis");
  await join(BOB, crew.inviteCode);
  const a1 = await logRide(ALICE, "A1", "2026-11-01T07:00:00.000Z");
  const a2 = await logRide(ALICE, "A2", "2026-11-03T07:00:00.000Z");
  const a3 = await logRide(ALICE, "A3", "2026-11-03T07:00:00.000Z"); // same time as A2: the cursor must not skip it
  const b1 = await logRide(BOB, "B1", "2026-11-02T07:00:00.000Z");
  const bPrivate = await logRide(BOB, "B private", "2026-11-04T07:00:00.000Z");
  await share(BOB, b1, [crew.id]);
  await call("POST", `/api/rides/${b1}/kudos`, { as: ALICE });
  await call("POST", `/api/rides/${b1}/comments`, { as: ALICE, body: { body: "Nice" } });

  const p1 = (await call("GET", "/api/feed?limit=2", { as: ALICE })).json;
  assert.equal(p1.items.length, 2);
  assert.ok(p1.next);
  const p2 = (await call("GET", `/api/feed?limit=2&before=${encodeURIComponent(p1.next)}`, { as: ALICE })).json;
  const all = [...p1.items, ...p2.items];
  assert.equal(p2.next, null, "no empty last page");
  assert.deepEqual(all.map((i: any) => i.id), [...[a2, a3].sort().reverse(), b1, a1], "ties broken by id");
  assert.ok(!all.some((i: any) => i.id === bPrivate), "Bob's private ride never shows");

  const b = all.find((i: any) => i.id === b1);
  assert.deepEqual([b.mine, b.rider.name, b.kudos, b.kudoed, b.comments], [false, "Bob", 1, true, 1]);
  assert.deepEqual(b.crews, [{ id: crew.id, name: "Kakis" }]);
  assert.equal(all.find((i: any) => i.id === a1).mine, true);

  // A bare ISO date works as `before` too.
  assert.deepEqual((await call("GET", "/api/feed?before=2026-11-02T07:00:00.000Z", { as: ALICE })).json.items.map((i: any) => i.name), ["A1"]);
  assert.equal((await call("GET", "/api/feed?limit=99", { as: ALICE })).status, 400);
  assert.equal((await call("GET", "/api/feed?before=yesterday", { as: ALICE })).status, 400);
});

test("leaving a crew un-shares your rides from it", async () => {
  const crew = await newCrew(ALICE, "Kakis");
  await join(BOB, crew.inviteCode);
  const id = await logRide(BOB, "Bob's");
  await share(BOB, id, [crew.id]);
  assert.equal(await sees(ALICE, id), true);
  await call("DELETE", `/api/crews/${crew.id}/members/me`, { as: BOB });
  assert.equal(await sees(ALICE, id), false);
  assert.deepEqual((await call("GET", `/api/rides/${id}/sharing`, { as: BOB })).json.crewIds, []);
  assert.equal((await call("GET", "/api/rides", { as: BOB })).json.rides[0].visibility, "private");
  // Joining again doesn't quietly re-share old rides.
  await join(BOB, crew.inviteCode);
  assert.equal(await sees(ALICE, id), false);
});

test("suggestions are crewmates you don't follow; follow by id works only for crewmates", async () => {
  const crew = await newCrew(ALICE, "Kakis");
  await join(BOB, crew.inviteCode);
  const sugg = (await call("GET", "/api/me/follow", { as: ALICE })).json.suggestions;
  assert.deepEqual(sugg.map((p: any) => p.name), ["Bob"]);
  assert.equal((await call("POST", "/api/follow", { as: ALICE, body: { userId: sugg[0].id } })).json.status, "pending");
  assert.deepEqual((await call("GET", "/api/me/follow", { as: ALICE })).json.suggestions, []);

  const daveId = (await call("GET", "/api/me", { as: DAVE })).json.id;
  assert.equal((await call("POST", "/api/follow", { as: ALICE, body: { userId: daveId } })).status, 404, "strangers can't be found by id");
});

test("profile pictures are visible across a follow, pending or accepted", async () => {
  const jpeg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString("base64");
  const url = (await call("PUT", "/api/me/avatar", { as: ALICE, body: { image: jpeg } })).json.avatar as string;
  const get = (as: string) => Promise.resolve(app.request(url, { headers: { "X-Dev-Email": as } }, env)).then((r) => r.status);
  assert.equal(await get(CAROL), 404);
  await call("POST", "/api/follow", { as: CAROL, body: { code: await codeOf(ALICE) } });
  assert.equal(await get(CAROL), 200, "Alice can see who's asking and Carol whom she asked");
  assert.equal(await get(DAVE), 404);
});

test("a viewer who leaves a crew loses its rides; authors can still take back comments and kudos", async () => {
  const crew = await newCrew(ALICE, "Kakis");
  await join(BOB, crew.inviteCode);
  await join(CAROL, crew.inviteCode);
  const id = await logRide(ALICE, "Coast");
  await share(ALICE, id, [crew.id]);
  const bobs = (await call("POST", `/api/rides/${id}/comments`, { as: BOB, body: { body: "Nice" } })).json.comment;
  const carols = (await call("POST", `/api/rides/${id}/comments`, { as: CAROL, body: { body: "Same" } })).json.comment;
  await call("POST", `/api/rides/${id}/kudos`, { as: BOB });
  await call("POST", `/api/rides/${id}/kudos`, { as: CAROL });

  await call("DELETE", `/api/crews/${crew.id}/members/me`, { as: BOB });
  assert.equal(await sees(BOB, id), false, "left the crew, lost the ride");
  assert.deepEqual(await feedIds(BOB), []);
  assert.equal((await call("GET", `/api/rides/${id}/comments`, { as: BOB })).status, 404);
  assert.equal((await call("POST", `/api/rides/${id}/kudos`, { as: BOB })).status, 404);

  assert.equal((await call("DELETE", `/api/comments/${carols.id}`, { as: BOB })).status, 404, "still not someone else's");
  assert.equal((await call("DELETE", `/api/comments/${bobs.id}`, { as: BOB })).status, 200, "your own, always");
  assert.deepEqual((await call("DELETE", `/api/rides/${id}/kudos`, { as: BOB })).json, { kudoed: false }, "no count once you can't see it");
  assert.equal((await call("DELETE", `/api/rides/${id}/kudos`, { as: BOB })).status, 404, "nothing left to take back");
  assert.equal((await call("DELETE", `/api/rides/${id}/kudos`, { as: DAVE })).status, 404);
  assert.deepEqual((await call("DELETE", `/api/rides/${id}/kudos`, { as: CAROL })).json, { kudos: 0, kudoed: false });
  assert.equal((await call("DELETE", `/api/comments/${carols.id}`, { as: ALICE })).status, 200, "the rider can delete any comment");
});

test("a new account has no name: social screens say Kayuh rider, crew screens keep the email name", async () => {
  const FRANK = "frank@example.com";
  assert.equal((await call("GET", "/api/me", { as: FRANK })).json.displayName, null);
  const crew = await newCrew(ALICE, "Kakis");
  await join(FRANK, crew.inviteCode);
  const id = await logRide(FRANK, "Frank's");
  await share(FRANK, id, [crew.id]);
  const item = (await call("GET", "/api/feed", { as: ALICE })).json.items.find((i: any) => i.id === id);
  assert.equal(item.rider.name, "Kayuh rider");
  assert.equal((await call("GET", `/api/rides/${id}`, { as: ALICE })).json.ride.rider.name, "Kayuh rider");
  await call("POST", `/api/rides/${id}/comments`, { as: FRANK, body: { body: "Hi" } });
  assert.equal((await call("GET", `/api/rides/${id}/comments`, { as: ALICE })).json.comments[0].author.name, "Kayuh rider");
  assert.deepEqual((await call("GET", "/api/me/follow", { as: ALICE })).json.suggestions.map((p: any) => p.name), ["Kayuh rider"]);
  const members = (await call("GET", `/api/crews/${crew.id}`, { as: ALICE })).json.members;
  assert.equal(members.find((m: any) => !m.me).name, "frank", "crewmates joined by invite");
});

test("ride times are stored as ISO UTC", async () => {
  await call("POST", "/api/rides", { as: ALICE, body: ride("Offset", "2026-11-01T07:00:00+08:00") });
  assert.equal((await call("GET", "/api/rides", { as: ALICE })).json.rides[0].riddenAt, "2026-10-31T23:00:00.000Z");
});

test("every API route needs an identity except the public ones", async () => {
  assert.equal((await call("GET", "/api/health")).status, 200);
  assert.equal((await call("GET", "/api/share/nope")).status, 404, "public, just not found");
  assert.equal((await call("GET", "/api/no-such-thing")).status, 401);
  assert.equal((await call("GET", "/api/rides/x/comments", { device: DEVICE })).status, 401);
  assert.equal((await call("GET", "/api/crew-rides", { device: DEVICE })).json.signIn, true);
  assert.equal((await call("GET", "/api/rides", { device: DEVICE })).status, 200, "devices keep their own rides");
});
