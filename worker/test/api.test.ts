import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { getConditions } from "../src/conditions.ts";
import { app, type Env } from "../src/index.ts";
import { searchPlaces } from "../src/search.ts";
import { testDb } from "./d1shim.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
let env: Env;

beforeEach(() => {
  env = { DB: testDb() };
});

async function call(method: string, path: string, opts: { device?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.device) headers["X-Kayuh-Device"] = opts.device;
  const res = await app.request(path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
  return { status: res.status, json: (await res.json()) as any };
}

const route = {
  name: "Coast to Changi", mode: "ab", profile: "nicest",
  points: [[103.9135, 1.3016], [103.9876, 1.3893]],
  prefs: { speedKmh: 15, footpathAversion: 0.5, crossingAversion: 0.5 },
  distanceM: 17000, timeS: 5640, tierM: [12750, 500, 300, 3300, 150, 0], legs: 4, polyline: "_p~iF~ps|U_ulLnnqC",
};

test("per-device endpoints need a device id", async () => {
  assert.equal((await call("GET", "/api/routes")).status, 401);
  assert.equal((await call("GET", "/api/routes", { device: "not-a-uuid" })).status, 401);
  assert.equal((await call("GET", "/api/routes", { device: ME })).status, 200);
});

test("save, list, share and unshare a route", async () => {
  const created = await call("POST", "/api/routes", { device: ME, body: route });
  assert.equal(created.status, 201);
  const list = await call("GET", "/api/routes", { device: ME });
  assert.equal(list.json.routes.length, 1);
  assert.deepEqual(list.json.routes[0].points, route.points);

  const share = await call("POST", `/api/routes/${created.json.id}/share`, { device: ME });
  const again = await call("POST", `/api/routes/${created.json.id}/share`, { device: ME });
  assert.equal(share.json.token, again.json.token, "sharing twice keeps the same link");
  const pub = await call("GET", `/api/share/${share.json.token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.json.route.name, "Coast to Changi");

  await call("DELETE", `/api/routes/${created.json.id}/share`, { device: ME });
  assert.equal((await call("GET", `/api/share/${share.json.token}`)).status, 404);
});

test("routes are private to their device", async () => {
  const { json } = await call("POST", "/api/routes", { device: ME, body: route });
  assert.equal((await call("GET", `/api/routes/${json.id}`, { device: OTHER })).status, 404);
  assert.equal((await call("DELETE", `/api/routes/${json.id}`, { device: OTHER })).status, 404);
  assert.equal((await call("GET", "/api/routes", { device: OTHER })).json.routes.length, 0);
  assert.equal((await call("DELETE", `/api/routes/${json.id}`, { device: ME })).status, 200);
});

test("bad route bodies are rejected", async () => {
  const outside = { ...route, points: [[0, 0], [103.9, 1.3]] };
  const r = await call("POST", "/api/routes", { device: ME, body: outside });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Singapore/);
  assert.equal((await call("POST", "/api/routes", { device: ME, body: { ...route, mode: "teleport" } })).status, 400);
});

test("rides are private by default and can be shared with the crew", async () => {
  const ride = { name: "Sunday", riddenAt: "2026-10-19T07:30:00+08:00", distanceM: 17000, timeS: 5600,
    tierM: route.tierM, polyline: route.polyline, source: "planned" };
  const { json } = await call("POST", "/api/rides", { device: ME, body: ride });
  // The app sends routeId: null for a route that was never saved.
  assert.equal((await call("POST", "/api/rides", { device: ME, body: { ...ride, routeId: null } })).status, 201);
  await call("DELETE", `/api/rides/${(await call("GET", "/api/rides", { device: ME })).json.rides.find((r: any) => r.id !== json.id).id}`, { device: ME });
  let rides = (await call("GET", "/api/rides", { device: ME })).json.rides;
  assert.equal(rides[0].visibility, "private");
  await call("PATCH", `/api/rides/${json.id}`, { device: ME, body: { visibility: "crew" } });
  rides = (await call("GET", "/api/rides", { device: ME })).json.rides;
  assert.equal(rides[0].visibility, "crew");
  assert.equal(rides[0].predictedS, null);
});

test("recorded rides keep the predicted time for pace learning", async () => {
  const ride = { name: "Commute", riddenAt: "2026-10-20T08:00:00+08:00", distanceM: 4000, timeS: 1500,
    tierM: route.tierM, polyline: route.polyline, source: "recorded", predictedS: 1320 };
  await call("POST", "/api/rides", { device: ME, body: ride });
  assert.equal((await call("GET", "/api/rides", { device: ME })).json.rides[0].predictedS, 1320);
});

test("settings round-trip", async () => {
  assert.equal((await call("GET", "/api/me", { device: ME })).json.operator, "helloride");
  await call("PUT", "/api/me", { device: ME, body: { operator: "anywheel", capMinutes: 30, speedKmh: 14 } });
  const me = (await call("GET", "/api/me", { device: ME })).json;
  assert.deepEqual([me.operator, me.capMinutes, me.speedKmh], ["anywheel", 30, 14]);
});

test("closed-segment reports expire by default", async () => {
  await call("POST", "/api/feedback", { device: ME, body: { lon: 103.95, lat: 1.35, rating: "closed" } });
  await call("POST", "/api/feedback", { device: ME, body: { lon: 103.95, lat: 1.35, rating: "great" } });
  const fb = (await call("GET", "/api/feedback", { device: ME })).json.feedback;
  assert.equal(fb.length, 2);
  assert.ok(fb.find((f: any) => f.rating === "closed").expires_at);
  assert.equal(fb.find((f: any) => f.rating === "great").expires_at, null);
});

test("search maps OneMap results and drops duplicates", async () => {
  const fake = (async () => new Response(JSON.stringify({
    results: [
      { SEARCHVAL: "CHANGI VILLAGE", BUILDING: "CHANGI VILLAGE", ADDRESS: "CHANGI VILLAGE", POSTAL: "NIL", LATITUDE: "1.3887", LONGITUDE: "103.988" },
      { SEARCHVAL: "CHANGI VILLAGE", BUILDING: "CHANGI VILLAGE", ADDRESS: "CHANGI VILLAGE", POSTAL: "NIL", LATITUDE: "1.38871", LONGITUDE: "103.98801" },
    ],
  }))) as typeof fetch;
  const places = await searchPlaces("changi village", undefined, fake);
  assert.deepEqual(places, [{ name: "Changi Village", address: "Changi Village", postal: "", lat: 1.3887, lon: 103.988 }]);
});

test("conditions pick the nearest forecast area and station", async () => {
  const data: Record<string, unknown> = {
    "two-hr-forecast": { data: {
      area_metadata: [{ name: "Bedok", label_location: { latitude: 1.321, longitude: 103.924 } },
        { name: "Jurong West", label_location: { latitude: 1.34, longitude: 103.7 } }],
      items: [{ valid_period: { end: "2026-10-21T15:30:00+08:00" }, forecasts: [{ area: "Bedok", forecast: "Thundery Showers" }, { area: "Jurong West", forecast: "Fair" }] }],
    } },
    "air-temperature": { data: { stations: [{ id: "S1", name: "Changi", location: { latitude: 1.36, longitude: 103.98 } }], readings: [{ data: [{ stationId: "S1", value: 31.2 }] }] } },
    "weather?api=wbgt": { data: { records: [{ item: { readings: [{ station: { name: "Changi" }, location: { latitude: "1.36", longitude: "103.98" }, wbgt: "30.7", heatStress: "Low" }] } }] } },
  };
  const c = await getConditions(1.32, 103.93, async (url) => data[url.split("/api/")[1]]);
  assert.equal(c.forecast?.area, "Bedok");
  assert.equal(c.forecast?.rainLikely, true);
  assert.equal(c.tempC?.value, 31.2);
  assert.equal(c.heat?.level, "Low");
});
