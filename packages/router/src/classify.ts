import type { LonLat } from "./geo.ts";
import { nearestNode, type Graph } from "./graph.ts";

const SNAP_M = 25;

/** Edges that end at each node, built once per graph (adjacency only lists the edges you can leave a node by). */
const incoming = new WeakMap<Graph, { start: Uint32Array; edges: Uint32Array }>();
function incomingEdges(g: Graph) {
  let inc = incoming.get(g);
  if (!inc) {
    const start = new Uint32Array(g.nodeCount + 1);
    for (let e = 0; e < g.edgeCount; e++) start[g.edgeTo[e] + 1]++;
    for (let i = 0; i < g.nodeCount; i++) start[i + 1] += start[i];
    const fill = start.slice(0, g.nodeCount), edges = new Uint32Array(g.edgeCount);
    for (let e = 0; e < g.edgeCount; e++) edges[fill[g.edgeTo[e]]++] = e;
    inc = { start, edges };
    incoming.set(g, inc);
  }
  return inc;
}

/**
 * Path type (tier 0-5) under each point of a ridden or imported track: the best (lowest) tier among
 * the edges at the nearest network node within 25 m, or -1 when no node is that close (off the map).
 * Only core nodes count, as for stops, so a stray service-road stub doesn't claim a point.
 */
export function classifyPoints(g: Graph, coords: LonLat[]): number[] {
  const inc = incomingEdges(g);
  return coords.map(([lon, lat]) => {
    const hit = nearestNode(g, lon, lat, { core: true, maxM: SNAP_M });
    if (!hit) return -1;
    const n = hit.node;
    let best = Infinity;
    for (let k = g.adjStart[n]; k < g.adjStart[n + 1]; k++) best = Math.min(best, g.edgeTier[g.adjEntry[k] >>> 1]);
    for (let k = inc.start[n]; k < inc.start[n + 1]; k++) best = Math.min(best, g.edgeTier[inc.edges[k]]);
    return Number.isFinite(best) ? best : -1;
  });
}
