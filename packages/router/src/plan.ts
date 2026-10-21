import { Searcher, type Step } from "./astar.ts";
import { bearing, haversine, offset, turnAngle, type LonLat } from "./geo.ts";
import {
  edgeCoords, edgeName, nearestNode, nodeLL, PCN, ROAD, TIERS, type Graph,
} from "./graph.ts";
import type { Poi, PoiIndex, PoiKind } from "./pois.ts";
import {
  costModel, DEFAULT_PREFS, REPARK_S, traverse, WALK_MS, type CostModel, type Prefs, type ProfileName,
} from "./profile.ts";

/** Seconds kept in reserve per leg so a slow patch doesn't push you over the free ride limit. */
export const LEG_SAFETY_S = 150;
const PARKING_SEARCH_M = 600;   // how far from a tapped start/end we look for legal parking
const ALONG_ROUTE_M = 150;      // how far off the route a mid-ride parking stop may be
const LEG_CHOICE_WINDOW_S = 240; // among stops this close to the furthest one, prefer amenities
const MIN_LEG_S = 300;           // a mid-ride parking stop must be at least this far into the leg
const FAR_PARKING_WARN_M = 300;

export interface PlanContext {
  graph: Graph;
  pois: PoiIndex;
  searcher: Searcher;
}

export function createContext(graph: Graph, pois: PoiIndex): PlanContext {
  return { graph, pois, searcher: new Searcher(graph) };
}

export interface PlanRequest {
  /** Start, optional via points, end. For a loop, start and end are the same point. */
  points: LonLat[];
  prefs?: Prefs;
  /** Free minutes per rental ride (HelloRide/Anywheel pass: 30). null = don't split. */
  capMinutes?: number | null;
  /** Start and end at legal bike parking (default true). */
  snapToParking?: boolean;
}

export interface Stop {
  kind: "start" | "end" | "via" | "park";
  lon: number;
  lat: number;
  name: string;
  /** Legal parking used at this stop, if any. */
  parking?: Poi;
  /** Walk between the tapped point and the parking/route, metres. */
  walkM?: number;
  amenities?: PoiKind[];
}

export interface Leg {
  from: Stop;
  to: Stop;
  distanceM: number;
  timeS: number;
  overCap: boolean;
  /** Range into RouteResult.coords. */
  startIndex: number;
  endIndex: number;
}

export interface Instruction {
  type: "depart" | "turn-left" | "turn-right" | "bear-left" | "bear-right" | "uturn" | "continue" | "join" | "park" | "arrive";
  text: string;
  /** Distance from the route start, metres. */
  atM: number;
  lon: number;
  lat: number;
}

export interface TierSegment {
  tier: number;
  /** Inclusive coord index range. */
  from: number;
  to: number;
}

export interface RouteResult {
  profile: ProfileName;
  coords: LonLat[];
  /** Cumulative distance at each coord, metres. */
  cumM: number[];
  distanceM: number;
  /** Metres per tier (pcn, cycleway, shared, footpath, quiet_road, road). */
  tierM: number[];
  /** Riding time including waits at lights, crossings and re-parks between legs (seconds). */
  timeS: number;
  /** Walking between your points and the parking at either end (seconds), not in timeS. */
  walkS: number;
  /** Number of sets of traffic lights you wait at. */
  signals: number;
  /** Where those lights are. */
  lights: LonLat[];
  crossings: number;
  segments: TierSegment[];
  legs: Leg[];
  instructions: Instruction[];
  warnings: string[];
  steps: Step[];
  /** The via points this route was planned through (loop corners included), to replay it exactly. */
  vias: LonLat[];
}

export class PlanError extends Error {}

// ------------------------------------------------------------ endpoints

function parkingStop(ctx: PlanContext, [lon, lat]: LonLat, kind: "start" | "end"): { node: number; stop: Stop } | null {
  const near = ctx.pois.near(lon, lat, PARKING_SEARCH_M, "parking");
  if (!near.length) return null;
  // Prefer sheltered or official racks when they are only slightly further away.
  const best = near
    .map(({ poi, dist }) => ({ poi, dist, score: dist + poi.walk - (poi.c ? 40 : 0) - (poi.s === "lta" ? 20 : 0) }))
    .sort((a, b) => a.score - b.score)[0];
  return {
    node: best.poi.node,
    stop: {
      kind, lon: best.poi.lon, lat: best.poi.lat, name: parkingName(best.poi), parking: best.poi,
      walkM: Math.round(best.dist), amenities: ctx.pois.amenitiesNear(best.poi.lon, best.poi.lat),
    },
  };
}

export function parkingName(p: Poi): string {
  const base = p.n || (p.s === "lta" ? "LTA bike rack" : "Bike parking");
  return p.c ? `${base} (sheltered)` : base;
}

function pointStop(ctx: PlanContext, ll: LonLat, kind: Stop["kind"]): { node: number; stop: Stop } {
  const hit = nearestNode(ctx.graph, ll[0], ll[1], { nice: true, maxM: 300 })
    ?? nearestNode(ctx.graph, ll[0], ll[1], { maxM: 3000 });
  if (!hit) throw new PlanError("That point is too far from any rideable path.");
  const [lon, lat] = nodeLL(ctx.graph, hit.node);
  return { node: hit.node, stop: { kind, lon, lat, name: "", walkM: Math.round(hit.dist) } };
}

// ------------------------------------------------------------ path helpers

function routeThrough(ctx: PlanContext, nodes: number[], cm: CostModel): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const r = ctx.searcher.route(nodes[i], nodes[i + 1], cm);
    if (!r) throw new PlanError("No rideable connection between these points.");
    steps.push(...r.steps);
  }
  return steps;
}

const stepEnd = (g: Graph, s: Step) => (s.backward ? g.edgeFrom[s.edge] : g.edgeTo[s.edge]);

/** Cumulative seconds at the end of each step, waits included. */
const timeline = (g: Graph, steps: Step[], prefs: Prefs): number[] => traverse(g, steps, prefs).times;

interface ParkCandidate { poi: Poi; stepIndex: number; timeS: number; score: number }

/** Parking stops along the route between minS and budgetS of riding, keyed by POI (latest sighting wins). */
function parkingCandidates(ctx: PlanContext, steps: Step[], times: number[], minS: number, budgetS: number, prefs: Prefs) {
  const g = ctx.graph;
  const speed = prefs.speedKmh / 3.6;
  const best = new Map<number, ParkCandidate>();
  for (let i = 0; i < steps.length; i++) {
    if (times[i] > budgetS) break;
    if (times[i] < minS) continue;
    const [lon, lat] = nodeLL(g, stepEnd(g, steps[i]));
    for (const { poi, dist } of ctx.pois.near(lon, lat, ALONG_ROUTE_M, "parking")) {
      const timeS = times[i] + (dist * 1.4) / speed;
      if (timeS > budgetS) continue;
      const prev = best.get(poi.id!);
      if (!prev || prev.timeS < timeS) {
        const amen = ctx.pois.amenitiesNear(poi.lon, poi.lat);
        const score = amen.length + (poi.c ? 0.5 : 0) + (poi.s === "lta" ? 0.25 : 0);
        best.set(poi.id!, { poi, stepIndex: i, timeS, score });
      }
    }
  }
  return [...best.values()];
}

/**
 * Legal parking reachable within the budget along the route, best first: stops near the end of
 * the budget ranked by amenities, then everything else from furthest to nearest.
 */
function parkingAlong(ctx: PlanContext, steps: Step[], times: number[], budgetS: number, prefs: Prefs): ParkCandidate[] {
  // A stop must make real progress, otherwise the parking we just left would qualify.
  const all = parkingCandidates(ctx, steps, times, Math.min(MIN_LEG_S, budgetS * 0.2), budgetS, prefs);
  if (!all.length) return [];
  // Don't stop absurdly early: aim for stops in the last part of the budget.
  const usable = all.filter((c) => c.timeS >= budgetS * 0.45);
  const pool = usable.length ? usable : all;
  const maxT = Math.max(...pool.map((c) => c.timeS));
  const best = pool.filter((c) => c.timeS >= maxT - LEG_CHOICE_WINDOW_S).sort((a, b) => b.score - a.score || b.timeS - a.timeS);
  const rest = all.filter((c) => !best.includes(c)).sort((a, b) => b.timeS - a.timeS);
  return [...best, ...rest];
}

/** How many candidate stops to actually route to before settling for an over-limit leg. */
const MAX_STOP_TRIES = 6;

/** The first parking after the budget runs out: the least-bad place to end an over-limit leg. */
function firstParkingAfter(ctx: PlanContext, steps: Step[], times: number[], budgetS: number, prefs: Prefs): ParkCandidate | null {
  const later = parkingCandidates(ctx, steps, times, budgetS, Infinity, prefs);
  return later.sort((a, b) => a.timeS - b.timeS)[0] ?? null;
}

// ------------------------------------------------------------ main entry

/** Plan one route with a given profile. */
export function planRoute(ctx: PlanContext, req: PlanRequest, profile: ProfileName): RouteResult {
  const g = ctx.graph;
  const prefs = req.prefs ?? DEFAULT_PREFS;
  if (req.points.length < 2) throw new PlanError("Need a start and an end.");
  const cm = costModel(g, profile, prefs);
  const snap = req.snapToParking ?? true;
  const warnings: string[] = [];

  const first = req.points[0];
  const last = req.points[req.points.length - 1];
  const start = (snap && parkingStop(ctx, first, "start")) || pointStop(ctx, first, "start");
  const isLoop = haversine(first[0], first[1], last[0], last[1]) < 30;
  const end = isLoop ? { node: start.node, stop: { ...start.stop, kind: "end" as const } }
    : (snap && parkingStop(ctx, last, "end")) || pointStop(ctx, last, "end");
  if (snap && !start.stop.parking) warnings.push(`No legal bike parking within ${PARKING_SEARCH_M} m of your start.`);
  if (snap && !end.stop.parking) warnings.push(`No legal bike parking within ${PARKING_SEARCH_M} m of your destination: you may be fined for parking there.`);
  let vias = req.points.slice(1, -1).map((p) => pointStop(ctx, p, "via"));

  for (const s of [start.stop, end.stop]) {
    if (s.parking && (s.walkM ?? 0) > FAR_PARKING_WARN_M) {
      warnings.push(`Nearest legal parking to your ${s.kind} is ${s.walkM} m away (${s.name}).`);
    }
  }

  const cap = req.capMinutes ? req.capMinutes * 60 : Infinity;
  const budget = cap - LEG_SAFETY_S;
  const legSteps: { steps: Step[]; from: Stop; to: Stop; overCap: boolean }[] = [];
  let cur = start;
  for (let guard = 0; ; guard++) {
    const nodes = [cur.node, ...vias.map((v) => v.node), end.node];
    const steps = routeThrough(ctx, nodes, cm);
    const times = timeline(g, steps, prefs);
    const total = times.length ? times[times.length - 1] : 0;
    // The last leg may use most of the safety margin: an extra stop to save one minute isn't worth it.
    if (total <= cap - 60 || guard >= 40) {
      legSteps.push({ steps, from: cur.stop, to: end.stop, overCap: total > cap });
      if (total > cap) warnings.push(`The last leg runs over your free ${req.capMinutes} min.`);
      break;
    }
    // Candidates are judged on the through-route; the real leg to a stop can differ a little
    // (a detour into a car park, extra turns), so check the actual leg before accepting it.
    const ranked = [...parkingAlong(ctx, steps, times, budget, prefs), ...parkingAlong(ctx, steps, times, cap, prefs)]
      .filter((c, i, arr) => c.poi.node !== end.node && arr.findIndex((o) => o.poi.id === c.poi.id) === i);
    let chosen: { pick: ParkCandidate; leg: Step[]; legTime: number; reached: number } | null = null;
    const tryStop = (pick: ParkCandidate) => {
      // Vias reached before the stop are part of this leg.
      const reached = viasReached(g, steps, vias.map((v) => v.node), pick.stepIndex);
      const leg = routeThrough(ctx, [cur.node, ...vias.slice(0, reached).map((v) => v.node), pick.poi.node], cm);
      return { pick, leg, legTime: timeline(g, leg, prefs).at(-1) ?? 0, reached };
    };
    for (const pick of ranked.slice(0, MAX_STOP_TRIES)) {
      const t = tryStop(pick);
      if (t.legTime <= cap) { chosen = t; break; }
    }
    if (!chosen) {
      const after = firstParkingAfter(ctx, steps, times, cap, prefs);
      if (!after || after.poi.node === end.node) {
        warnings.push(`No legal parking along the rest of the route; the last leg runs over your free ${req.capMinutes} min.`);
        legSteps.push({ steps, from: cur.stop, to: end.stop, overCap: true });
        break;
      }
      chosen = tryStop(after);
      warnings.push(`No legal parking within ${req.capMinutes} min after ${cur.stop.name || "the start"}: leg ${legSteps.length + 1} runs about ${Math.ceil((chosen.legTime - cap) / 60)} min over.`);
    }
    const { pick, leg, legTime, reached } = chosen;
    const parkNode = pick.poi.node;
    const parkStop: Stop = {
      kind: "park", lon: pick.poi.lon, lat: pick.poi.lat, name: parkingName(pick.poi), parking: pick.poi,
      amenities: ctx.pois.amenitiesNear(pick.poi.lon, pick.poi.lat),
    };
    legSteps.push({ steps: leg, from: cur.stop, to: parkStop, overCap: legTime > cap });
    vias = vias.slice(reached);
    cur = { node: parkNode, stop: parkStop };
  }

  return { ...assemble(ctx, profile, prefs, legSteps, warnings), vias: req.points.slice(1, -1) };
}

function viasReached(g: Graph, steps: Step[], viaNodes: number[], uptoStep: number): number {
  let reached = 0;
  for (let i = 0; i <= uptoStep && reached < viaNodes.length; i++) {
    if (stepEnd(g, steps[i]) === viaNodes[reached]) reached++;
  }
  return reached;
}

function assemble(
  ctx: PlanContext, profile: ProfileName, prefs: Prefs,
  legSteps: { steps: Step[]; from: Stop; to: Stop; overCap: boolean }[], warnings: string[],
): Omit<RouteResult, "vias"> {
  const g = ctx.graph;
  const coords: LonLat[] = [];
  const cumM: number[] = [];
  const tierM = [0, 0, 0, 0, 0, 0];
  const segments: TierSegment[] = [];
  const legs: Leg[] = [];
  const allSteps: Step[] = [];
  const lights: LonLat[] = [];
  let crossings = 0, timeS = 0, dist = 0;

  for (const ls of legSteps) {
    const startIndex = Math.max(0, coords.length - 1);
    let legDist = 0;
    const tr = traverse(g, ls.steps, prefs);
    const legTime = tr.times.at(-1) ?? 0;
    for (const n of tr.lights) lights.push(nodeLL(g, n));
    crossings += tr.crossings;
    if (!coords.length) {
      coords.push([ls.from.lon, ls.from.lat]);
      cumM.push(0);
    }
    for (const s of ls.steps) {
      const pts = edgeCoords(g, s.edge, s.backward);
      const tier = g.edgeTier[s.edge];
      const segFrom = coords.length - 1;
      for (let i = 1; i < pts.length; i++) {
        const prev = coords[coords.length - 1];
        coords.push(pts[i]);
        cumM.push(cumM[cumM.length - 1] + haversine(prev[0], prev[1], pts[i][0], pts[i][1]));
      }
      const last = segments[segments.length - 1];
      if (last && last.tier === tier && last.to === segFrom) last.to = coords.length - 1;
      else segments.push({ tier, from: segFrom, to: coords.length - 1 });
      tierM[tier] += g.edgeLen[s.edge];
      legDist += g.edgeLen[s.edge];
    }
    allSteps.push(...ls.steps);
    legs.push({ from: ls.from, to: ls.to, distanceM: legDist, timeS: legTime, overCap: ls.overCap, startIndex, endIndex: coords.length - 1 });
    dist += legDist;
    timeS += legTime;
  }
  // Each stop between legs costs a re-park: lock, scan, end the ride, unlock again.
  timeS += Math.max(0, legs.length - 1) * REPARK_S;
  const walkS = ((legs[0]?.from.walkM ?? 0) + (legs.at(-1)?.to.walkM ?? 0)) / WALK_MS;
  if (tierM[ROAD] > 0.25 * dist && dist > 500) warnings.push("More than a quarter of this route is on roads.");

  return {
    profile, coords, cumM, distanceM: dist, timeS, walkS, tierM, signals: lights.length, lights, crossings, segments, legs,
    instructions: instructions(g, allSteps, legs, cumM, new Set(lights.map(([lon, lat]) => `${lon},${lat}`))),
    warnings, steps: allSteps,
  };
}

// ------------------------------------------------------------ turn-by-turn

function headingAt(pts: LonLat[], atEnd: boolean): number {
  const [a, b] = atEnd ? [pts[pts.length - 2], pts[pts.length - 1]] : [pts[0], pts[1]];
  return bearing(a[0], a[1], b[0], b[1]);
}

function instructions(g: Graph, steps: Step[], legs: Leg[], cumM: number[], lightAt: Set<string>): Instruction[] {
  const out: Instruction[] = [];
  if (!steps.length) return out;
  const first = edgeName(g, steps[0].edge);
  const [lon0, lat0] = edgeCoords(g, steps[0].edge, steps[0].backward)[0];
  out.push({ type: "depart", text: first ? `Head off on ${first}` : "Head off", atM: 0, lon: lon0, lat: lat0 });
  let atM = 0;
  for (let i = 0; i + 1 < steps.length; i++) {
    atM += g.edgeLen[steps[i].edge];
    const a = steps[i], b = steps[i + 1];
    const pa = edgeCoords(g, a.edge, a.backward), pb = edgeCoords(g, b.edge, b.backward);
    const angle = turnAngle(headingAt(pa, true), headingAt(pb, false));
    const nameA = edgeName(g, a.edge), nameB = edgeName(g, b.edge);
    const node = stepEnd(g, a);
    const [lon, lat] = nodeLL(g, node);
    const onto = nameB ? ` onto ${nameB}` : "";
    const lights = lightAt.has(`${lon},${lat}`) ? " at the lights" : "";
    const abs = Math.abs(angle);
    let ins: Instruction | null = null;
    if (abs >= 150) ins = { type: "uturn", text: `Make a U-turn${onto}`, atM, lon, lat };
    else if (abs >= 60) ins = { type: angle > 0 ? "turn-right" : "turn-left", text: `Turn ${angle > 0 ? "right" : "left"}${onto}${lights}`, atM, lon, lat };
    else if (abs >= 28) ins = { type: angle > 0 ? "bear-right" : "bear-left", text: `Bear ${angle > 0 ? "right" : "left"}${onto}${lights}`, atM, lon, lat };
    else if (g.edgeTier[b.edge] === PCN && g.edgeTier[a.edge] !== PCN) ins = { type: "join", text: `Join ${nameB || "the park connector"}`, atM, lon, lat };
    else if (nameB && nameB !== nameA) ins = { type: "continue", text: `Continue onto ${nameB}`, atM, lon, lat };
    if (!ins) continue;
    const prev = out[out.length - 1];
    // Tiny zig-zags at path junctions: keep only the later instruction.
    if (prev && prev.type !== "depart" && ins.atM - prev.atM < 15) out.pop();
    out.push(ins);
  }
  legs.forEach((leg, i) => {
    const isLast = i === legs.length - 1;
    out.push({
      type: isLast ? "arrive" : "park",
      text: isLast
        ? `Arrive${leg.to.name ? ` at ${leg.to.name}` : ""}${leg.to.parking ? ": park and end your ride" : ""}`
        : `Park at ${leg.to.name}: end ride ${i + 1}, then unlock again`,
      atM: cumM[leg.endIndex],
      lon: leg.to.lon,
      lat: leg.to.lat,
    });
  });
  return out.sort((x, y) => x.atM - y.atM);
}

// ------------------------------------------------------------ alternatives & loops

export interface PlanResponse {
  routes: RouteResult[];
}

/** Nicest / balanced / direct, with near-duplicates removed. */
export function planAlternatives(ctx: PlanContext, req: PlanRequest): PlanResponse {
  const routes: RouteResult[] = [];
  for (const p of ["nicest", "balanced", "direct"] as ProfileName[]) {
    const r = planRoute(ctx, req, p);
    const dup = routes.some((o) => Math.abs(o.distanceM - r.distanceM) < Math.max(50, 0.01 * r.distanceM)
      && Math.abs(o.tierM[ROAD] - r.tierM[ROAD]) < 50);
    if (!dup) routes.push(r);
  }
  return { routes };
}

export interface LoopRequest {
  start: LonLat;
  targetKm: number;
  prefs?: Prefs;
  capMinutes?: number | null;
}

/**
 * Loop suggestions: triangles through two via points in eight directions,
 * scored on share of nice paths, distance fit and how little the loop doubles back.
 */
export function planLoops(ctx: PlanContext, req: LoopRequest, count = 3): RouteResult[] {
  const g = ctx.graph;
  const target = req.targetKm * 1000;
  const side = target / 3.9; // road-network detour makes the real loop ~25-30% longer than the triangle
  const startPark = parkingStop(ctx, req.start, "start");
  const origin: LonLat = startPark ? [startPark.stop.lon, startPark.stop.lat] : req.start;
  const scored: { r: RouteResult; score: number; corners: LonLat[] }[] = [];
  for (let h = 0; h < 360; h += 45) {
    const a = offset(origin[0], origin[1], side, h);
    const b = offset(origin[0], origin[1], side, h + 60);
    const na = nearestNode(g, a[0], a[1], { nice: true, maxM: 800 });
    const nb = nearestNode(g, b[0], b[1], { nice: true, maxM: 800 });
    if (!na || !nb) continue;
    const corners = [nodeLL(g, na.node), nodeLL(g, nb.node)];
    let r: RouteResult;
    try {
      r = planRoute(ctx, { points: [origin, ...corners, origin], prefs: req.prefs, capMinutes: null }, "nicest");
    } catch {
      continue;
    }
    const nice = (r.tierM[0] + r.tierM[1] + r.tierM[2]) / Math.max(1, r.distanceM);
    const fit = 1 - Math.min(1, Math.abs(r.distanceM - target) / target);
    const used = new Map<number, number>();
    for (const s of r.steps) used.set(s.edge, (used.get(s.edge) ?? 0) + 1);
    let repeated = 0;
    for (const s of r.steps) if ((used.get(s.edge) ?? 0) > 1) repeated += g.edgeLen[s.edge];
    const overlap = repeated / Math.max(1, r.distanceM);
    scored.push({ r, corners, score: 0.5 * nice + 0.35 * fit + 0.15 * (1 - overlap) });
  }
  scored.sort((x, y) => y.score - x.score);
  const picked: RouteResult[] = [];
  for (const { r, corners } of scored) {
    if (Math.abs(r.distanceM - target) > 0.5 * target) continue;
    if (picked.some((p) => Math.abs(p.distanceM - r.distanceM) < 300)) continue;
    // Re-plan the winners with the free-ride limit so they come with legs.
    picked.push(planRoute(ctx, { points: [origin, ...corners, origin], prefs: req.prefs, capMinutes: req.capMinutes }, "nicest"));
    if (picked.length === count) break;
  }
  return picked;
}

export { TIERS };
