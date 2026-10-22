import { bearing, haversine, type LonLat } from "./geo.ts";

export const TIERS = ["pcn", "cycleway", "shared", "footpath", "quiet_road", "road"] as const;
export type TierName = (typeof TIERS)[number];
export const PCN = 0, CYCLEWAY = 1, SHARED = 2, FOOTPATH = 3, QUIET_ROAD = 4, ROAD = 5;

// Edge flags: keep in sync with pipeline/classify.py
export const F_FWD = 1, F_BWD = 2, F_LIT = 4, F_SHELTER = 8, F_UNPAVED = 16, F_DISMOUNT = 32, F_BRIDGE = 64, F_SIDEWALK = 128;
// Node flags: keep in sync with pipeline/build.py
export const N_SIGNAL = 1, N_CROSSING = 2;

const NO_NAME = 0xffffffff;
const GRID_DEG = 0.002; // ~220 m cells

export interface Graph {
  nodeCount: number;
  edgeCount: number;
  nodeLon: Int32Array; // degrees * 1e6
  nodeLat: Int32Array;
  nodeFlags: Uint8Array;
  edgeFrom: Uint32Array;
  edgeTo: Uint32Array;
  edgeLen: Float32Array; // metres
  edgeTier: Uint8Array;
  edgeFlags: Uint8Array;
  edgeName: Uint32Array;
  edgeReason: Uint32Array;
  geomStart: Uint32Array; // edgeCount + 1 offsets into coords (intermediate points only)
  coords: Int32Array; // lon,lat pairs * 1e6
  strings: string[];
  /** CSR adjacency: entries are edge * 2 + (0 = forward along the edge, 1 = backward). */
  adjStart: Uint32Array;
  adjEntry: Uint32Array;
  /** True if the node touches at least one non-road edge. */
  niceNode: Uint8Array;
  /**
   * 1 if the node is in the largest strongly connected part of the network: you can ride from
   * it to everywhere else in that part and back. Stops snap only to these, so a one-way dead end
   * (say, a service road into a car park) can never strand the next leg.
   */
  coreNode: Uint8Array;
  grid: { lon0: number; lat0: number; cols: number; rows: number; cellStart: Uint32Array; cellNodes: Uint32Array };
}

/** Parse graph.bin (written by pipeline/build.py). */
export function parseGraph(buf: ArrayBuffer): Graph {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "KYH1") throw new Error(`not a Kayuh graph (${magic})`);
  const nodeCount = dv.getUint32(8, true);
  const edgeCount = dv.getUint32(12, true);
  const coordCount = dv.getUint32(16, true);
  const strBytes = dv.getUint32(20, true);
  let off = 24;
  const pad = (n: number) => n + ((4 - (n % 4)) % 4);
  const take = <T>(ctor: new (b: ArrayBuffer, o: number, n: number) => T, n: number, bytesPer: number): T => {
    const arr = new ctor(buf, off, n);
    off += pad(n * bytesPer);
    return arr;
  };
  const nodeLon = take(Int32Array, nodeCount, 4);
  const nodeLat = take(Int32Array, nodeCount, 4);
  const nodeFlags = take(Uint8Array, nodeCount, 1);
  const edgeFrom = take(Uint32Array, edgeCount, 4);
  const edgeTo = take(Uint32Array, edgeCount, 4);
  const edgeLen = take(Float32Array, edgeCount, 4);
  const edgeTier = take(Uint8Array, edgeCount, 1);
  const edgeFlags = take(Uint8Array, edgeCount, 1);
  const edgeName = take(Uint32Array, edgeCount, 4);
  const edgeReason = take(Uint32Array, edgeCount, 4);
  const geomStart = take(Uint32Array, edgeCount + 1, 4);
  const coords = take(Int32Array, coordCount * 2, 4);
  const strings = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, strBytes))) as string[];
  return finishGraph({ nodeCount, edgeCount, nodeLon, nodeLat, nodeFlags, edgeFrom, edgeTo, edgeLen, edgeTier, edgeFlags, edgeName, edgeReason, geomStart, coords, strings });
}

type RawGraph = Omit<Graph, "adjStart" | "adjEntry" | "niceNode" | "coreNode" | "grid">;

/** Build adjacency, the nice-node mask and the spatial grid. Also used by tests with hand-made graphs. */
export function finishGraph(g: RawGraph): Graph {
  const { nodeCount, edgeCount } = g;
  const deg = new Uint32Array(nodeCount + 1);
  const niceNode = new Uint8Array(nodeCount);
  for (let e = 0; e < edgeCount; e++) {
    const f = g.edgeFlags[e];
    if (f & F_FWD) deg[g.edgeFrom[e] + 1]++;
    if (f & F_BWD) deg[g.edgeTo[e] + 1]++;
    if (g.edgeTier[e] !== ROAD) niceNode[g.edgeFrom[e]] = niceNode[g.edgeTo[e]] = 1;
  }
  for (let i = 0; i < nodeCount; i++) deg[i + 1] += deg[i];
  const adjStart = deg.slice();
  const fill = deg.slice(0, nodeCount);
  const adjEntry = new Uint32Array(adjStart[nodeCount]);
  for (let e = 0; e < edgeCount; e++) {
    const f = g.edgeFlags[e];
    if (f & F_FWD) adjEntry[fill[g.edgeFrom[e]]++] = e * 2;
    if (f & F_BWD) adjEntry[fill[g.edgeTo[e]]++] = e * 2 + 1;
  }

  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (let i = 0; i < nodeCount; i++) {
    const lon = g.nodeLon[i] / 1e6, lat = g.nodeLat[i] / 1e6;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const cols = Math.max(1, Math.ceil((maxLon - minLon) / GRID_DEG) + 1);
  const rows = Math.max(1, Math.ceil((maxLat - minLat) / GRID_DEG) + 1);
  const cellOf = new Uint32Array(nodeCount);
  const cellStart = new Uint32Array(cols * rows + 1);
  for (let i = 0; i < nodeCount; i++) {
    const c = Math.floor((g.nodeLon[i] / 1e6 - minLon) / GRID_DEG) + cols * Math.floor((g.nodeLat[i] / 1e6 - minLat) / GRID_DEG);
    cellOf[i] = c;
    cellStart[c + 1]++;
  }
  for (let c = 0; c < cols * rows; c++) cellStart[c + 1] += cellStart[c];
  const cursor = cellStart.slice(0, cols * rows);
  const cellNodes = new Uint32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) cellNodes[cursor[cellOf[i]]++] = i;

  const coreNode = largestScc(g, adjStart, adjEntry);
  return { ...g, adjStart, adjEntry, niceNode, coreNode, grid: { lon0: minLon, lat0: minLat, cols, rows, cellStart, cellNodes } };
}

/** Kosaraju's algorithm, iterative (the graph is too big for recursion). Marks the largest SCC. */
function largestScc(g: RawGraph, adjStart: Uint32Array, adjEntry: Uint32Array): Uint8Array {
  const n = g.nodeCount;
  const target = (entry: number) => (entry & 1 ? g.edgeFrom[entry >>> 1] : g.edgeTo[entry >>> 1]);
  // Pass 1: finish order on the forward graph.
  const order = new Uint32Array(n);
  let filled = 0;
  const seen = new Uint8Array(n);
  const stackNode = new Uint32Array(n), stackPos = new Uint32Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    let top = 0;
    stackNode[0] = s; stackPos[0] = adjStart[s]; seen[s] = 1;
    while (top >= 0) {
      const u = stackNode[top];
      if (stackPos[top] < adjStart[u + 1]) {
        const v = target(adjEntry[stackPos[top]++]);
        if (!seen[v]) { seen[v] = 1; top++; stackNode[top] = v; stackPos[top] = adjStart[v]; }
      } else {
        order[filled++] = u;
        top--;
      }
    }
  }
  // Reverse adjacency (who can step into each node).
  const rdeg = new Uint32Array(n + 1);
  for (let k = 0; k < adjEntry.length; k++) rdeg[target(adjEntry[k]) + 1]++;
  for (let i = 0; i < n; i++) rdeg[i + 1] += rdeg[i];
  const rfill = rdeg.slice(0, n), rsrc = new Uint32Array(adjEntry.length);
  for (let u = 0; u < n; u++) for (let k = adjStart[u]; k < adjStart[u + 1]; k++) rsrc[rfill[target(adjEntry[k])]++] = u;
  // Pass 2: components on the reverse graph in reverse finish order.
  const comp = new Int32Array(n).fill(-1);
  const stack = new Uint32Array(n);
  let best = -1, bestSize = 0, c = 0;
  for (let i = n - 1; i >= 0; i--) {
    const s = order[i];
    if (comp[s] >= 0) continue;
    let top = 0, size = 0;
    stack[0] = s; comp[s] = c;
    while (top >= 0) {
      const u = stack[top--];
      size++;
      for (let k = rdeg[u]; k < rdeg[u + 1]; k++) {
        const v = rsrc[k];
        if (comp[v] < 0) { comp[v] = c; stack[++top] = v; }
      }
    }
    if (size > bestSize) { bestSize = size; best = c; }
    c++;
  }
  const core = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (comp[i] === best) core[i] = 1;
  return core;
}

export const nodeLL = (g: Graph, n: number): LonLat => [g.nodeLon[n] / 1e6, g.nodeLat[n] / 1e6];

export function edgeName(g: Graph, e: number): string {
  const i = g.edgeName[e];
  return i === NO_NAME ? "" : g.strings[i];
}

export const edgeReason = (g: Graph, e: number): string => g.strings[g.edgeReason[e]];

/** Full geometry of an edge in travel direction, endpoints included. */
export function edgeCoords(g: Graph, e: number, backward: boolean): LonLat[] {
  const pts: LonLat[] = [nodeLL(g, g.edgeFrom[e])];
  for (let i = g.geomStart[e]; i < g.geomStart[e + 1]; i++) pts.push([g.coords[2 * i] / 1e6, g.coords[2 * i + 1] / 1e6]);
  pts.push(nodeLL(g, g.edgeTo[e]));
  return backward ? pts.reverse() : pts;
}

/** Bearing leaving the start and arriving at the end of an edge, in travel direction. */
export function edgeHeadings(g: Graph, e: number, backward: boolean): [number, number] {
  const s = g.geomStart[e], n = g.geomStart[e + 1] - s;
  const pt = (i: number): LonLat => {
    // i indexes the full polyline: 0 = from node, n + 1 = to node.
    if (i === 0) return nodeLL(g, g.edgeFrom[e]);
    if (i === n + 1) return nodeLL(g, g.edgeTo[e]);
    return [g.coords[2 * (s + i - 1)] / 1e6, g.coords[2 * (s + i - 1) + 1] / 1e6];
  };
  const [a0, a1, b0, b1] = backward ? [pt(n + 1), pt(n), pt(1), pt(0)] : [pt(0), pt(1), pt(n), pt(n + 1)];
  return [bearing(a0[0], a0[1], a1[0], a1[1]), bearing(b0[0], b0[1], b1[0], b1[1])];
}

/**
 * Nearest graph node to a point, searching outward ring by ring.
 * With `nice`, only nodes touching a non-road edge qualify.
 */
export function nearestNode(g: Graph, lon: number, lat: number, opts: { nice?: boolean; core?: boolean; maxM?: number } = {}): { node: number; dist: number } | null {
  const { lon0, lat0, cols, rows, cellStart, cellNodes } = g.grid;
  const maxM = opts.maxM ?? 2000;
  const cx = Math.floor((lon - lon0) / GRID_DEG);
  const cy = Math.floor((lat - lat0) / GRID_DEG);
  const maxRing = Math.ceil(maxM / 200) + 1;
  let best = -1, bestD = Infinity;
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let y = cy - ring; y <= cy + ring; y++) {
      for (let x = cx - ring; x <= cx + ring; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== ring) continue;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const c = x + y * cols;
        for (let k = cellStart[c]; k < cellStart[c + 1]; k++) {
          const n = cellNodes[k];
          if (opts.nice && !g.niceNode[n]) continue;
          if (opts.core && !g.coreNode[n]) continue;
          const d = haversine(lon, lat, g.nodeLon[n] / 1e6, g.nodeLat[n] / 1e6);
          if (d < bestD) { bestD = d; best = n; }
        }
      }
    }
    // A node in ring r is at least (r - 1) cells away; stop once nothing closer can exist.
    if (best >= 0 && bestD < (ring) * 200) break;
  }
  return best >= 0 && bestD <= maxM ? { node: best, dist: bestD } : null;
}
