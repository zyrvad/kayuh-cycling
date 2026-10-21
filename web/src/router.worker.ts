/// <reference lib="webworker" />
/** Runs the router off the main thread: loads graph.bin + pois.json once, then answers plan requests. */
import {
  createContext, haversine, parseGraph, parkingName, planAlternatives, planLoops, PoiIndex, toGpx,
  type LoopRequest, type PlanContext, type PlanRequest, type Poi,
} from "@kayuh/router";

export type WorkerRequest =
  | { type: "plan"; req: PlanRequest }
  | { type: "loops"; req: LoopRequest }
  | { type: "gpx"; route: Parameters<typeof toGpx>[0]; name: string }
  | { type: "parkingNear"; lon: number; lat: number; radiusM: number }
  | { type: "pois" }
  | { type: "parkingNearRoute"; coords: [number, number][]; radiusM: number };

let ctx: PlanContext | null = null;
let pois: Poi[] = [];
const ready = (async () => {
  const [g, p] = await Promise.all([
    fetch("/data/graph.bin").then((r) => r.arrayBuffer()),
    fetch("/data/pois.json").then((r) => r.json()),
  ]);
  pois = p.pois;
  ctx = createContext(parseGraph(g), new PoiIndex(pois));
  postMessage({ type: "ready", nodes: ctx.graph.nodeCount, built: p.built });
})();

function handle(msg: WorkerRequest): unknown {
  const c = ctx!;
  switch (msg.type) {
    case "plan":
      return planAlternatives(c, msg.req).routes;
    case "loops":
      return planLoops(c, msg.req);
    case "gpx":
      return toGpx(msg.route, msg.name);
    case "parkingNear":
      return c.pois.near(msg.lon, msg.lat, msg.radiusM, "parking").map(({ poi, dist }) => ({ ...poi, name: parkingName(poi), dist: Math.round(dist) }));
    case "pois":
      return pois;
    case "parkingNearRoute": {
      // Sample the line every radius/2, interpolating along long straight segments,
      // so nothing within reach slips between samples.
      const ids = new Set<number>();
      const step = msg.radiusM / 2;
      const sample = (lon: number, lat: number) => {
        for (const { poi } of c.pois.near(lon, lat, msg.radiusM, "parking")) ids.add(poi.id!);
      };
      msg.coords.forEach(([lon, lat], i) => {
        if (i === 0) return sample(lon, lat);
        const [plon, plat] = msg.coords[i - 1];
        const n = Math.max(1, Math.ceil(haversine(plon, plat, lon, lat) / step));
        for (let k = 1; k <= n; k++) sample(plon + ((lon - plon) * k) / n, plat + ((lat - plat) * k) / n);
      });
      return [...ids];
    }
  }
}

self.onmessage = async (e: MessageEvent<{ id: number; msg: WorkerRequest }>) => {
  const { id, msg } = e.data;
  try {
    await ready;
    postMessage({ id, ok: true, result: handle(msg) });
  } catch (err) {
    postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
