import { F_DISMOUNT, F_UNPAVED, FOOTPATH, N_CROSSING, N_SIGNAL, type Graph } from "./graph.ts";

export type ProfileName = "nicest" | "balanced" | "direct";

/** User preferences. Sliders in the app map onto these. */
export interface Prefs {
  /** Riding speed on paths, km/h. Rental bikes cruise around 15. */
  speedKmh: number;
  /** 0 = treat footpaths like any path, 1 = avoid them hard. */
  footpathAversion: number;
  /** 0 = ignore crossings, 1 = strongly prefer routes with fewer of them. */
  crossingAversion: number;
}

export const DEFAULT_PREFS: Prefs = { speedKmh: 15, footpathAversion: 0.5, crossingAversion: 0.5 };

/** Cost multiplier per tier: pcn, cycleway, shared, footpath, quiet_road, road. */
const TIER_COST: Record<ProfileName, number[]> = {
  nicest: [1.0, 1.1, 1.3, 2.0, 2.6, 6.0],
  balanced: [1.0, 1.05, 1.15, 1.5, 1.6, 3.0],
  direct: [1.0, 1.0, 1.0, 1.15, 1.1, 1.6],
};

// SG law: 10 km/h on footpaths, 25 km/h on shared and cycling paths.
const FOOTPATH_LIMIT_KMH = 10;
const PATH_LIMIT_KMH = 25;
const WALK_KMH = 4.5;
const SIGNAL_WAIT_S = 25;
const CROSSING_WAIT_S = 6;

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

/** Seconds to ride an edge. */
export function edgeTime(g: Graph, e: number, prefs: Prefs = DEFAULT_PREFS): number {
  const f = g.edgeFlags[e];
  let kmh = Math.min(prefs.speedKmh, PATH_LIMIT_KMH);
  if (g.edgeTier[e] === FOOTPATH) kmh = Math.min(kmh, FOOTPATH_LIMIT_KMH);
  if (f & F_UNPAVED) kmh *= 0.8;
  if (f & F_DISMOUNT) kmh = WALK_KMH;
  return g.edgeLen[e] / (kmh / 3.6);
}

export function nodeTime(g: Graph, n: number): number {
  const fl = g.nodeFlags[n];
  return fl & N_SIGNAL ? SIGNAL_WAIT_S : fl & N_CROSSING ? CROSSING_WAIT_S : 0;
}
