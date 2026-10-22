import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createContext, F_BWD, F_FWD, finishGraph, haversine, nearestNode, PCN, planAlternatives, planRoute, PoiIndex,
  ROAD, toGpx, type Graph, type LonLat, type Poi,
} from "../src/index.ts";

/** Build a graph from nodes and [from, to, tier, flags?] edges. */
function makeGraph(nodes: LonLat[], edges: [number, number, number, number?][]): Graph {
  const E = edges.length;
  const g = finishGraph({
    nodeCount: nodes.length,
    edgeCount: E,
    nodeLon: Int32Array.from(nodes, ([lon]) => Math.round(lon * 1e6)),
    nodeLat: Int32Array.from(nodes, ([, lat]) => Math.round(lat * 1e6)),
    nodeFlags: new Uint8Array(nodes.length),
    edgeFrom: Uint32Array.from(edges, (e) => e[0]),
    edgeTo: Uint32Array.from(edges, (e) => e[1]),
    edgeLen: Float32Array.from(edges, ([a, b]) => haversine(...nodes[a], ...nodes[b])),
    edgeTier: Uint8Array.from(edges, (e) => e[2]),
    edgeFlags: Uint8Array.from(edges, (e) => e[3] ?? F_FWD | F_BWD),
    edgeName: new Uint32Array(E).fill(0xffffffff),
    edgeReason: new Uint32Array(E),
    geomStart: new Uint32Array(E + 1),
    coords: new Int32Array(0),
    strings: ["test"],
  });
  return g;
}

const parking = (node: number, [lon, lat]: LonLat): Poi => ({ k: "parking", lon, lat, n: "", s: "lta", c: 0, node, walk: 0 });

// S --road (1.1 km)-- T, and a PCN detour S -> M -> T of ~2.5 km.
const S: LonLat = [103.8, 1.3], T: LonLat = [103.81, 1.3], M: LonLat = [103.805, 1.31];
const triangle = () => makeGraph([S, T, M], [[0, 1, ROAD, F_FWD], [0, 2, PCN], [2, 1, PCN]]);

test("nicest takes the PCN detour, direct takes the road", () => {
  const ctx = createContext(triangle(), new PoiIndex([]));
  const req = { points: [S, T], snapToParking: false, capMinutes: null };
  const nicest = planRoute(ctx, req, "nicest");
  const direct = planRoute(ctx, req, "direct");
  assert.equal(nicest.tierM[ROAD], 0);
  assert.ok(nicest.tierM[PCN] > 2000);
  assert.ok(direct.tierM[ROAD] > 1000);
  assert.ok(direct.distanceM < nicest.distanceM);
  assert.equal(planAlternatives(ctx, req).routes.length, 2, "balanced duplicates nicest here");
});

test("one-way roads are not ridden backwards", () => {
  const ctx = createContext(triangle(), new PoiIndex([]));
  const back = planRoute(ctx, { points: [T, S], snapToParking: false, capMinutes: null }, "direct");
  assert.equal(back.tierM[ROAD], 0);
});

test("nearestNode finds the closest node and honours the nice filter", () => {
  const g = triangle();
  assert.equal(nearestNode(g, 103.8001, 1.3001)?.node, 0);
  assert.equal(nearestNode(g, 103.806, 1.309, { nice: true })?.node, 2);
});

// A straight 10 km PCN, nodes every 500 m.
function chain() {
  const nodes: LonLat[] = [];
  for (let i = 0; i <= 20; i++) nodes.push([103.7 + i * 0.0044966, 1.3]);
  const edges: [number, number, number][] = [];
  for (let i = 0; i < 20; i++) edges.push([i, i + 1, PCN]);
  return { nodes, g: makeGraph(nodes, edges) };
}

test("routes are split into legs under the free-ride cap, ending at legal parking", () => {
  const { nodes, g } = chain();
  const pois = new PoiIndex([0, 6, 10, 13, 16, 20].map((n) => parking(n, nodes[n])));
  const ctx = createContext(g, pois);
  const r = planRoute(ctx, { points: [nodes[0], nodes[20]], capMinutes: 30 }, "nicest");
  assert.equal(r.legs.length, 2);
  assert.equal(r.legs[0].to.parking?.node, 10, "furthest parking within 27.5 min at 13 km/h");
  assert.ok(r.legs.every((l) => l.timeS <= 30 * 60 && !l.overCap));
  assert.ok(Math.abs(r.distanceM - 10000) < 50);
  assert.equal(r.instructions.filter((i) => i.type === "park").length, 1);
  assert.equal(r.instructions.at(-1)?.type, "arrive");
});

test("a leg with no reachable parking is flagged over the cap", () => {
  const { nodes, g } = chain();
  const pois = new PoiIndex([0, 20].map((n) => parking(n, nodes[n])));
  const r = planRoute(createContext(g, pois), { points: [nodes[0], nodes[20]], capMinutes: 30 }, "nicest");
  assert.equal(r.legs.length, 1);
  assert.ok(r.legs[0].overCap);
  assert.ok(r.warnings.some((w) => w.includes("runs over")));
});

test("start and end snap to nearby parking", () => {
  const { nodes, g } = chain();
  const pois = new PoiIndex([parking(1, nodes[1]), parking(19, nodes[19])]);
  // Tapped points 150 m from the parking spots.
  const a: LonLat = [nodes[1][0] - 0.00135, 1.3], b: LonLat = [nodes[19][0] + 0.00135, 1.3];
  const r = planRoute(createContext(g, pois), { points: [a, b], capMinutes: null }, "nicest");
  assert.equal(r.legs[0].from.parking?.node, 1);
  assert.ok(Math.abs((r.legs[0].from.walkM ?? 0) - 150) < 5);
  assert.equal(r.legs[0].to.parking?.node, 19);
  assert.ok(Math.abs(r.distanceM - 9000) < 50);
});

test("GPX has waypoints for each leg end and a track", () => {
  const { nodes, g } = chain();
  const pois = new PoiIndex([0, 6, 10, 13, 16, 20].map((n) => parking(n, nodes[n])));
  const r = planRoute(createContext(g, pois), { points: [nodes[0], nodes[20]], capMinutes: 30 }, "nicest");
  const gpx = toGpx(r, "Test <ride>");
  assert.match(gpx, /<gpx version="1.1"/);
  assert.equal((gpx.match(/<wpt /g) ?? []).length, 3); // start, P1, finish
  assert.ok((gpx.match(/<trkpt /g) ?? []).length >= 2);
  assert.ok(!gpx.includes("<ride>"));
});

test("lights on both carriageways of one road count once, and waits are added", async () => {
  const { N_SIGNAL, SIGNAL_WAIT_S, traverse } = await import("../src/index.ts");
  // 1 km straight path with two signal nodes 20 m apart (a divided road) and one more 500 m later.
  const nodes: LonLat[] = [[103.8, 1.3], [103.80027, 1.3], [103.80045, 1.3], [103.8045, 1.3], [103.809, 1.3]];
  const g = makeGraph(nodes, [[0, 1, PCN], [1, 2, PCN], [2, 3, PCN], [3, 4, PCN]]);
  g.nodeFlags[1] = g.nodeFlags[2] = g.nodeFlags[3] = N_SIGNAL;
  const r = planRoute(createContext(g, new PoiIndex([])), { points: [nodes[0], nodes[4]], snapToParking: false, capMinutes: null }, "nicest");
  assert.equal(r.signals, 2);
  assert.equal(r.lights.length, 2);
  const ride = r.steps.reduce((t, s) => t + g.edgeLen[s.edge] / (13 / 3.6), 0);
  assert.ok(Math.abs(r.timeS - (ride + 2 * SIGNAL_WAIT_S)) < 1, `${r.timeS} vs ${ride + 2 * SIGNAL_WAIT_S}`);
  assert.equal(traverse(g, r.steps).lights.length, 2);
});

test("re-parking between legs is added to the total time", () => {
  const { nodes, g } = chain();
  const pois = new PoiIndex([0, 6, 10, 13, 16, 20].map((n) => parking(n, nodes[n])));
  const r = planRoute(createContext(g, pois), { points: [nodes[0], nodes[20]], capMinutes: 30 }, "nicest");
  const legSum = r.legs.reduce((t, l) => t + l.timeS, 0);
  assert.equal(Math.round(r.timeS - legSum), 90 * (r.legs.length - 1));
});

test("a parking spot on a one-way dead end is never used as a leg stop", () => {
  // Chain of PCN with a one-way spur into node 21 (you can ride in, not out). Parking on the spur
  // must be skipped, or the next leg would have nowhere to go.
  const { nodes, g: chainGraph } = chain();
  const spur: LonLat = [nodes[13][0], 1.3009];
  const allNodes = [...nodes, spur];
  const edges: [number, number, number, number?][] = [];
  for (let i = 0; i < 20; i++) edges.push([i, i + 1, PCN]);
  edges.push([13, 21, PCN, F_FWD]);
  const g = makeGraph(allNodes, edges);
  assert.equal(g.coreNode[21], 0, "dead end is outside the core");
  assert.equal(chainGraph.coreNode[5], 1);
  const pois = new PoiIndex([parking(0, nodes[0]), parking(21, spur), parking(10, nodes[10]), parking(20, nodes[20])]);
  const r = planRoute(createContext(g, pois), { points: [nodes[0], nodes[20]], capMinutes: 30 }, "nicest");
  assert.ok(r.legs.every((l) => l.to.parking?.node !== 21));
  assert.equal(r.legs.at(-1)?.to.parking?.node, 20);
});
