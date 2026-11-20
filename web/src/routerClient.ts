import type { LonLat, LoopRequest, PlanRequest, Poi, RouteResult } from "@kayuh/router";
import type { WorkerRequest } from "./router.worker.ts";

export type NearbyParking = Poi & { name: string; dist: number };

const worker = new Worker(new URL("./router.worker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let nextId = 1;
let readyResolve: (info: { nodes: number; built: string }) => void;
export const routerReady = new Promise<{ nodes: number; built: string }>((r) => (readyResolve = r));

const progressListeners = new Set<(f: number) => void>();
/** Graph download progress, 0..1 (clamped below 1 until the router is ready). Returns an unsubscribe. */
export function onRouterProgress(cb: (f: number) => void): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

worker.onmessage = (e) => {
  const d = e.data;
  if (d.type === "progress") {
    const f = Math.min(0.95, d.loaded / d.total);
    progressListeners.forEach((cb) => cb(f));
    return;
  }
  if (d.type === "ready") return readyResolve(d);
  const p = pending.get(d.id);
  if (!p) return;
  pending.delete(d.id);
  if (d.ok) p.resolve(d.result);
  else p.reject(new Error(d.error));
};

function call<T>(msg: WorkerRequest): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, msg });
  });
}

export const router = {
  plan: (req: PlanRequest) => call<RouteResult[]>({ type: "plan", req }),
  loops: (req: LoopRequest) => call<RouteResult[]>({ type: "loops", req }),
  gpx: (route: RouteResult, name: string) => call<string>({ type: "gpx", route, name }),
  parkingNear: ([lon, lat]: LonLat, radiusM = 300) => call<NearbyParking[]>({ type: "parkingNear", lon, lat, radiusM }),
  pois: () => call<Poi[]>({ type: "pois" }),
  /** Path type (0-5, or -1 off the network) under each point, for imported tracks. */
  classify: (coords: LonLat[]) => call<number[]>({ type: "classify", coords }),
  /** Ids (indexes into pois()) of legal parking within radiusM of a route line. */
  parkingNearRoute: (coords: LonLat[], radiusM = 60) => call<number[]>({ type: "parkingNearRoute", coords, radiusM }),
};
