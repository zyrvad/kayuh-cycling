import type { Step } from "./astar.ts";
import { turnAngle } from "./geo.ts";
import { edgeHeadings, F_DISMOUNT, F_UNPAVED, FOOTPATH, N_CROSSING, N_SIGNAL, type Graph } from "./graph.ts";

export type ProfileName = "nicest" | "balanced" | "direct";

/** User preferences. Sliders in the app map onto these. */
export interface Prefs {
  /** Cruising speed on paths, km/h. Heavy rental bikes cruise around 13. */
  speedKmh: number;
  /** 0 = treat footpaths like any path, 1 = avoid them hard. */
  footpathAversion: number;
  /** 0 = ignore crossings, 1 = strongly prefer routes with fewer of them. */
  crossingAversion: number;
  /** Multiplier learned from your own rides (1 = take the model as is). */
  paceFactor?: number;
}

export const DEFAULT_PREFS: Prefs = { speedKmh: 13, footpathAversion: 0.5, crossingAversion: 0.5 };

/** Cost multiplier per tier: pcn, cycleway, shared, footpath, quiet_road, road. */
const TIER_COST: Record<ProfileName, number[]> = {
  nicest: [1.0, 1.1, 1.3, 2.0, 2.6, 6.0],
  balanced: [1.0, 1.05, 1.15, 1.5, 1.6, 3.0],
  direct: [1.0, 1.0, 1.0, 1.15, 1.1, 1.6],
};

// Timing model, calibrated against Google Maps on 10 SG routes (Oct 2026): Google assumes free-flowing
// riding, real rides take ~1.5-2x as long, and this model lands at a median of 1.76x.
// SG law caps footpaths at 10 km/h; with pedestrians around, 8 is what you actually average.
const FOOTPATH_KMH = 8;
const PATH_LIMIT_KMH = 25;
const WALK_KMH = 4.5;
/** Average wait at a signalised crossing (SG pedestrian cycles run ~90-150 s). */
export const SIGNAL_WAIT_S = 40;
const CROSSING_WAIT_S = 8;
/** Slowing down and speeding up again for a sharp turn. */
const TURN_S = 4;
/** Signal nodes this close together are one set of lights (divided roads, staggered crossings). */
const LIGHT_CLUSTER_M = 40;
/** Park, scan the QR code, end the ride, unlock again: per stop between legs. */
export const REPARK_S = 90;
export const WALK_MS = WALK_KMH / 3.6;

export interface CostModel {
  /** Generalised cost of traversing an edge (metre-equivalents). Always >= its length. */
  edgeCost: Float32Array;
  /** Extra cost for passing through a node (crossings, lights). */
  nodeCost(n: number): number;
}

export function costModel(g: Graph, profile: ProfileName, prefs: Prefs = DEFAULT_PREFS): CostModel {
  const tc = TIER_COST[profile].slice();
  // Footpath slider scales the footpath multiplier between "just a path" (1.2) and 2x the profile default.
  tc[FOOTPATH] = 1.2 + (tc[FOOTPATH] - 1.2) * (prefs.footpathAversion * 2);
  tc[FOOTPATH] = Math.max(1.0, tc[FOOTPATH]);
  const edgeCost = new Float32Array(g.edgeCount);
  for (let e = 0; e < g.edgeCount; e++) {
    let m = tc[g.edgeTier[e]];
    const f = g.edgeFlags[e];
    if (f & F_UNPAVED) m *= 1.3;
    if (f & F_DISMOUNT) m *= 2.5;
    edgeCost[e] = g.edgeLen[e] * m;
  }
  const scale = profile === "direct" ? 0.3 : 1;
  const signal = 120 * prefs.crossingAversion * 2 * scale;
  const crossing = 30 * prefs.crossingAversion * 2 * scale;
  return {
    edgeCost,
    nodeCost: (n) => {
      const fl = g.nodeFlags[n];
      return fl & N_SIGNAL ? signal : fl & N_CROSSING ? crossing : 0;
    },
  };
}

/** Seconds to ride an edge, before waits. */
export function edgeTime(g: Graph, e: number, prefs: Prefs = DEFAULT_PREFS): number {
  const f = g.edgeFlags[e];
  let kmh = Math.min(prefs.speedKmh, PATH_LIMIT_KMH);
  if (g.edgeTier[e] === FOOTPATH) kmh = Math.min(kmh, FOOTPATH_KMH);
  if (f & F_UNPAVED) kmh *= 0.8;
  if (f & F_DISMOUNT) kmh = WALK_KMH;
  return (g.edgeLen[e] / (kmh / 3.6)) * (prefs.paceFactor ?? 1);
}

export interface Traversal {
  /** Cumulative seconds at the end of each step, waits included. */
  times: number[];
  /** Nodes where you wait at traffic lights: one per set of lights. */
  lights: number[];
  crossings: number;
  turns: number;
}

/** Walk a path and add up riding time plus waits at lights, crossings and sharp turns. */
export function traverse(g: Graph, steps: Step[], prefs: Prefs = DEFAULT_PREFS): Traversal {
  const pace = prefs.paceFactor ?? 1;
  const times: number[] = [];
  const lights: number[] = [];
  let t = 0, along = 0, lastSignal = -Infinity, crossings = 0, turns = 0;
  let prevHeading: number | null = null;
  for (const s of steps) {
    const [h0, h1] = edgeHeadings(g, s.edge, s.backward);
    if (prevHeading !== null && Math.abs(turnAngle(prevHeading, h0)) >= 60) {
      t += TURN_S * pace;
      turns++;
    }
    prevHeading = h1;
    t += edgeTime(g, s.edge, prefs);
    along += g.edgeLen[s.edge];
    const n = s.backward ? g.edgeFrom[s.edge] : g.edgeTo[s.edge];
    const fl = g.nodeFlags[n];
    if (fl & N_SIGNAL) {
      if (along - lastSignal > LIGHT_CLUSTER_M) {
        t += SIGNAL_WAIT_S * pace;
        lights.push(n);
      }
      lastSignal = along;
    } else if (fl & N_CROSSING) {
      t += CROSSING_WAIT_S * pace;
      crossings++;
    }
    times.push(t);
  }
  return { times, lights, crossings, turns };
}
