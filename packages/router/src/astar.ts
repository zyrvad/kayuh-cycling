import { haversine } from "./geo.ts";
import type { Graph } from "./graph.ts";
import type { CostModel } from "./profile.ts";

/** One step of a path: the edge taken and whether it was ridden against its stored direction. */
export interface Step {
  edge: number;
  backward: boolean;
}

/** Binary min-heap over (priority, node) with lazy deletion. */
class Heap {
  private pri: Float64Array;
  private node: Uint32Array;
  size = 0;
  constructor(cap = 1 << 16) {
    this.pri = new Float64Array(cap);
    this.node = new Uint32Array(cap);
  }
  push(p: number, n: number) {
    if (this.size === this.pri.length) {
      const pri = new Float64Array(this.size * 2); pri.set(this.pri); this.pri = pri;
      const node = new Uint32Array(this.size * 2); node.set(this.node); this.node = node;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= p) break;
      this.pri[i] = this.pri[parent];
      this.node[i] = this.node[parent];
      i = parent;
    }
    this.pri[i] = p;
    this.node[i] = n;
  }
  /** Pops the minimum node; returns -1 when empty. */
  pop(): number {
    if (this.size === 0) return -1;
    const top = this.node[0];
    const p = this.pri[--this.size];
    const n = this.node[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.pri[c + 1] < this.pri[c]) c++;
      if (this.pri[c] >= p) break;
      this.pri[i] = this.pri[c];
      this.node[i] = this.node[c];
      i = c;
    }
    this.pri[i] = p;
    this.node[i] = n;
    return top;
  }
}

/** Reusable search state so repeated queries don't reallocate graph-sized arrays. */
export class Searcher {
  private dist: Float64Array;
  private via: Int32Array; // adjacency entry used to reach node, -1 = none
  private seen: Uint8Array;
  private touched: number[] = [];

  constructor(private g: Graph) {
    this.dist = new Float64Array(g.nodeCount).fill(Infinity);
    this.via = new Int32Array(g.nodeCount).fill(-1);
    this.seen = new Uint8Array(g.nodeCount);
  }

  private reset() {
    for (const n of this.touched) {
      this.dist[n] = Infinity;
      this.via[n] = -1;
      this.seen[n] = 0;
    }
    this.touched = [];
  }

  /** A* from `src` to `dst`. Returns the steps, or null if unreachable. */
  route(src: number, dst: number, cm: CostModel): { steps: Step[]; cost: number } | null {
    const g = this.g;
    this.reset();
    if (src === dst) return { steps: [], cost: 0 };
    const tLon = g.nodeLon[dst] / 1e6, tLat = g.nodeLat[dst] / 1e6;
    // Cost >= length everywhere, so straight-line distance never overestimates.
    const h = (n: number) => 0.995 * haversine(g.nodeLon[n] / 1e6, g.nodeLat[n] / 1e6, tLon, tLat);
    const heap = new Heap();
    this.dist[src] = 0;
    this.touched.push(src);
    heap.push(h(src), src);
    for (;;) {
      const u = heap.pop();
      if (u < 0) return null;
      if (this.seen[u]) continue;
      this.seen[u] = 1;
      if (u === dst) break;
      const du = this.dist[u];
      for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
        const entry = g.adjEntry[k];
        const e = entry >>> 1;
        const v = entry & 1 ? g.edgeFrom[e] : g.edgeTo[e];
        if (this.seen[v]) continue;
        const dv = du + cm.edgeCost[e] + cm.nodeCost(v);
        if (dv < this.dist[v]) {
          if (this.dist[v] === Infinity) this.touched.push(v);
          this.dist[v] = dv;
          this.via[v] = k;
          heap.push(dv + h(v), v);
        }
      }
    }
    const steps: Step[] = [];
    let n = dst;
    while (n !== src) {
      const entry = g.adjEntry[this.via[n]];
      const e = entry >>> 1;
      const backward = (entry & 1) === 1;
      steps.push({ edge: e, backward });
      n = backward ? g.edgeTo[e] : g.edgeFrom[e];
    }
    steps.reverse();
    return { steps, cost: this.dist[dst] };
  }
}
