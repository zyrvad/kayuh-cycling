import type { LonLat, LoopRequest, PlanRequest, Poi, RouteResult } from "@kayuh/router";
import type { WorkerRequest } from "./router.worker.ts";

export type NearbyParking = Poi & { name: string; dist: number };

const worker = new Worker(new URL("./router.worker.ts", import.meta.url), { type: "module" });
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let nextId = 1;
let readyResolve: (info: { nodes: number; built: string }) => void;
export const routerReady = new Promise<{ nodes: number; built: string }>((r) => (readyResolve = r));

worker.onmessage = (e) => {
  const d = e.data;
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
  /** Ids (indexes into pois()) of legal parking within radiusM of a route line. */
  parkingNearRoute: (coords: LonLat[], radiusM = 60) => call<number[]>({ type: "parkingNearRoute", coords, radiusM }),
};
