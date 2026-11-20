/// <reference lib="webworker" />
/** Runs the router off the main thread: loads graph.bin + pois.json once, then answers plan requests. */
import {
  classifyPoints, createContext, haversine, parseGraph, parkingName, planAlternatives, planLoops, PoiIndex, toGpx,
  type LoopRequest, type PlanContext, type PlanRequest, type Poi,
} from "@kayuh/router";

export type WorkerRequest =
  | { type: "plan"; req: PlanRequest }
  | { type: "loops"; req: LoopRequest }
  | { type: "gpx"; route: Parameters<typeof toGpx>[0]; name: string }
  | { type: "parkingNear"; lon: number; lat: number; radiusM: number }
  | { type: "pois" }
  | { type: "classify"; coords: [number, number][] }
  | { type: "parkingNearRoute"; coords: [number, number][]; radiusM: number };

let ctx: PlanContext | null = null;
let pois: Poi[] = [];
// Real size of web/public/data/graph.bin.gz, used when the server sends no Content-Length (chunked or re-encoded).
// Update when the graph is rebuilt; it only affects the progress bar, which is clamped to 0.95 until ready.
const GRAPH_GZ_BYTES_FALLBACK = 5_356_189;
const GRAPH_RAW_BYTES_FALLBACK = 12_608_968; // same file after gunzip

/** Fetch the gzipped graph, counting compressed bytes as they stream so the launch screen can show real progress. */
async function loadGraph(): Promise<ArrayBuffer> {
  const r = await fetch("/data/graph.bin.gz");
  const header = Number(r.headers.get("content-length"));
  // Some servers (the Vite dev server) send the .gz with Content-Encoding: gzip, so the browser has already
  // gunzipped it: the bytes we count are then raw ones and we must not decompress again.
  const decoded = !!r.headers.get("content-encoding");
  const total = decoded ? GRAPH_RAW_BYTES_FALLBACK : header > 0 ? header : GRAPH_GZ_BYTES_FALLBACK;
  let loaded = 0;
  let last = 0;
  const counter = new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      const now = performance.now();
      if (now - last >= 50) {
        last = now;
        postMessage({ type: "progress", loaded: Math.min(loaded, total * 0.95), total });
      }
      controller.enqueue(chunk);
    },
  });
  const buf = await new Response(r.body!.pipeThrough(counter)).arrayBuffer();
  // Decide by the gzip magic bytes, not headers: a CDN may add its own Content-Encoding (br) on top of the .gz,
  // which the browser strips, leaving gzip bytes that we still have to inflate.
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

const ready = (async () => {
  const [g, p] = await Promise.all([
    loadGraph(),
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
    case "classify":
      return classifyPoints(c.graph, msg.coords);
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
