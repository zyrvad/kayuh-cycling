/**
 * Seeds realistic local data through the local API (never SQL): four people, a crew, follows,
 * rides and saved routes with real Singapore geometry planned by the router package, kudos,
 * comments and a weekly goal. Re-running is safe: it stops if Jaden already has the seeded rides.
 *
 *   npx tsx web/scripts/seed-dev.mjs [--base http://127.0.0.1:8791]
 * Needs the local server with DEV_AUTH=1 (worker/.dev.vars).
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createContext, parseGraph, PoiIndex, planAlternatives, planLoops } from "@kayuh/router";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:8791");
const data = (f) => readFileSync(fileURLToPath(new URL(`../public/data/${f}`, import.meta.url)));

// ---- router ---------------------------------------------------------------------------------
const g = gunzipSync(data("graph.bin.gz"));
const pois = JSON.parse(data("pois.json").toString()).pois;
const ctx = createContext(parseGraph(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength)), new PoiIndex(pois));
const PREFS = { speedKmh: 15, footpathAversion: 0.5, crossingAversion: 0.5 };

function encodePolyline(coords) {
  let out = "", pLat = 0, pLon = 0;
  const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } out += String.fromCharCode(v + 63); };
  for (const [lon, lat] of coords) {
    const la = Math.round(lat * 1e5), lo = Math.round(lon * 1e5);
    enc(la - pLat); enc(lo - pLon); pLat = la; pLon = lo;
  }
  return out;
}

const PLACES = {
  ecp: [103.9127, 1.3027], bedok: [103.9300, 1.3140], gardens: [103.8636, 1.2816], barrage: [103.8708, 1.2800],
  bishan: [103.8447, 1.3631], amk: [103.8570, 1.3800], punggol: [103.9077, 1.4097], waterway: [103.9040, 1.3990],
  jurong: [103.7254, 1.3394], changi: [103.9876, 1.3896], kallang: [103.8700, 1.3040], sengkang: [103.8995, 1.3940],
};

/** Plan A to B (nicest option) and return the API route shape. */
function plan(name, pts, mode = "ab") {
  const r = planAlternatives(ctx, { points: pts.map((p) => PLACES[p] ?? p), prefs: PREFS, capMinutes: 30 }).routes[0];
  return toRoute(name, r, mode, pts.map((p) => PLACES[p] ?? p));
}
function loop(name, start, km) {
  const r = planLoops(ctx, { start: PLACES[start], targetKm: km, prefs: PREFS, capMinutes: 30 })[0];
  if (!r) throw new Error(`no loop for ${name}`);
  return toRoute(name, r, "loop", [PLACES[start], ...r.vias, PLACES[start]]);
}
function toRoute(name, r, mode, points) {
  return {
    name, mode, profile: r.profile, points, prefs: PREFS, distanceM: Math.round(r.distanceM), timeS: Math.round(r.timeS),
    tierM: r.tierM.map(Math.round), legs: r.legs.length, polyline: encodePolyline(r.coords),
  };
}

// ---- API ------------------------------------------------------------------------------------
async function call(who, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "X-Dev-Email": `${who}@kayuh.dev`, Origin: BASE, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${who} ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}
const NAMES = { jaden: "Jaden", weiling: "Wei Ling", arif: "Arif", priya: "Priya" };
const PEOPLE = Object.keys(NAMES);

const day = (daysAgo, hour) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 15, 0, 0); return d.toISOString(); };

/** A ride from a planned route; actual time is a little off the prediction. */
function rideOf(name, route, daysAgo, hour, extra = {}) {
  const timeS = Math.round(route.timeS * (0.95 + Math.random() * 0.15));
  const kmh = (route.distanceM / 1000) / (timeS / 3600);
  return {
    name, routeId: null, riddenAt: day(daysAgo, hour), distanceM: route.distanceM, timeS, tierM: route.tierM, polyline: route.polyline,
    source: "recorded", predictedS: route.timeS, visibility: "private",
    stats: { movingS: timeS - 120, elapsedS: timeS + 240, distanceM: route.distanceM, avgKmh: +kmh.toFixed(1), maxKmh: +(kmh + 9).toFixed(1), elevGainM: 20 + Math.round(Math.random() * 60), stops: 2, stoppedS: 240, ...extra },
  };
}

async function main() {
  const existing = await call("jaden", "GET", "/api/rides");
  if (existing.rides.some((r) => r.name === "Sunrise at East Coast Park")) {
    console.log("Already seeded (found 'Sunrise at East Coast Park'); nothing to do.");
    return;
  }

  // People: set names and ids.
  const ids = {};
  for (const p of PEOPLE) {
    const me = await call(p, "GET", "/api/me");
    await call(p, "PUT", "/api/me", { operator: "helloride", capMinutes: 30, speedKmh: 15, displayName: NAMES[p] });
    ids[p] = me.id;
  }
  console.log("people:", PEOPLE.join(", "));

  // Crew: Jaden creates, the rest join by code.
  const crew = (await call("jaden", "GET", "/api/crews")).crews.find((c) => c.name === "Sunday Kakis")
    ?? await call("jaden", "POST", "/api/crews", { name: "Sunday Kakis" });
  const code = crew.inviteCode ?? (await call("jaden", "GET", `/api/crews/${crew.id}`)).inviteCode;
  for (const p of PEOPLE.slice(1)) await call(p, "POST", "/api/crews/join", { code });
  console.log("crew: Sunday Kakis");

  // Jaden follows Wei Ling and Arif (crewmates, by id); accept if a request is pending.
  for (const p of ["weiling", "arif"]) {
    const r = await call("jaden", "POST", "/api/follow", { userId: ids[p] });
    if (r.status === "pending") await call(p, "POST", `/api/follow/requests/${ids.jaden}/accept`);
  }

  // Routes (real geometry).
  const R = {
    ecp: plan("East Coast Park to Changi Beach", ["ecp", "bedok", [103.9640, 1.3130]]),
    bay: plan("Gardens by the Bay to East Coast Park", ["gardens", "barrage", "ecp"]),
    bishan: loop("Bishan-Ang Mo Kio Park loop", "bishan", 14),
    punggol: loop("Punggol Waterway loop", "punggol", 16),
    jurong: loop("Jurong Lake Gardens loop", "jurong", 12),
    changi: plan("Punggol to Changi Village", ["punggol", "changi"]),
    kallang: plan("Kallang Riverside to Marina Barrage", ["kallang", "gardens", "barrage"]),
    sengkang: plan("Sengkang Riverside to Punggol", ["sengkang", "waterway", "punggol"]),
  };
  for (const [k, r] of Object.entries(R)) console.log(`  route ${k}: ${(r.distanceM / 1000).toFixed(1)} km`);

  // Jaden's saved routes.
  for (const k of ["bishan", "ecp", "punggol", "changi"]) await call("jaden", "POST", "/api/routes", R[k]);

  // Rides. [who, name, route, daysAgo, hour, share]  share: "crew" | "followers" | "both" | none
  const plan_ = [
    ["jaden", "Sunrise at East Coast Park", "ecp", 1, 7, "both", { avgHr: 142, maxHr: 171 }],
    ["jaden", "Bay loop after work", "bay", 3, 18, "crew", { avgHr: 135, maxHr: 160 }],
    ["jaden", "Bishan lap with kopi", "bishan", 5, 8, "followers", { avgHr: 138, maxHr: 165 }],
    ["jaden", "Punggol Waterway evening", "punggol", 8, 18, null, { avgHr: 140, maxHr: 168 }],
    ["jaden", "Changi Village makan run", "changi", 11, 7, "crew", { avgHr: 144, maxHr: 175 }],
    ["jaden", "Kallang to the Bay", "kallang", 13, 19, null, { avgHr: 130, maxHr: 158 }],
    ["weiling", "Jurong Lake sunrise", "jurong", 1, 7, "both"],
    ["weiling", "Bishan morning spin", "bishan", 6, 7, "crew"],
    ["weiling", "Bay to the Barrage", "bay", 10, 17, "followers"],
    ["arif", "Sengkang to Punggol", "sengkang", 2, 18, "both"],
    ["arif", "Changi Village breakfast", "changi", 4, 7, "crew"],
    ["priya", "East Coast easy spin", "ecp", 2, 8, "crew"],
    ["priya", "Punggol Waterway loop", "punggol", 7, 17, "crew"],
  ];
  const made = [];
  for (const [who, name, rk, d, h, share, extra] of plan_) {
    const { id } = await call(who, "POST", "/api/rides", rideOf(name, R[rk], d, h, extra));
    if (share) await call(who, "PUT", `/api/rides/${id}/sharing`, { crewIds: share === "followers" ? [] : [crew.id], followers: share !== "crew" });
    made.push({ who, name, id });
  }
  console.log(`rides: ${made.length}`);

  // Kudos and comments on others' rides, seen by Jaden and the crew.
  const find = (n) => made.find((m) => m.name === n).id;
  const social = [
    ["jaden", "Jurong Lake sunrise", "kudos"], ["arif", "Jurong Lake sunrise", "kudos"], ["priya", "Jurong Lake sunrise", "kudos"],
    ["jaden", "Sengkang to Punggol", "kudos"], ["weiling", "Sengkang to Punggol", "kudos"],
    ["weiling", "Sunrise at East Coast Park", "kudos"], ["arif", "Sunrise at East Coast Park", "kudos"],
    ["priya", "Sunrise at East Coast Park", "kudos"], ["priya", "Changi Village makan run", "kudos"],
  ];
  for (const [who, name] of social) await call(who, "POST", `/api/rides/${find(name)}/kudos`, {});
  const comments = [
    ["arif", "Sunrise at East Coast Park", "Early bird! Which end of the park did you start from?"],
    ["weiling", "Sunrise at East Coast Park", "That breeze is the best part of the weekend."],
    ["jaden", "Jurong Lake sunrise", "Love the new Lakeside path. Next time I'm joining."],
    ["priya", "Changi Village makan run", "Nasi lemak at Changi Village after? Count me in next Sunday."],
  ];
  for (const [who, name, body] of comments) await call(who, "POST", `/api/rides/${find(name)}/comments`, { body });

  // A weekly goal for Jaden.
  await call("jaden", "PUT", "/api/goals", { period: "week", metric: "distance", target: 60 });
  console.log("goal: 60 km / week. Done.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
