import type { LonLat } from "@kayuh/router";

/** Pure helpers first (unit-tested, no DOM); the offscreen map below loads MapLibre lazily. */

export const SNAP_W = 640;
export const SNAP_H = 360;
const STYLE = "https://tiles.openfreemap.org/styles/positron";
const CACHE_NAME = "kayuh-snapshots-v1";

export interface SnapshotOpts { width?: number; height?: number }

/** Keep at most `max` points, always the first and last. */
export function decimate(coords: LonLat[], max = 300): LonLat[] {
  if (coords.length <= max) return coords;
  const step = (coords.length - 1) / (max - 1);
  const out: LonLat[] = [];
  for (let i = 0; i < max - 1; i++) out.push(coords[Math.round(i * step)]);
  out.push(coords[coords.length - 1]);
  return out;
}

export function boundsOf(coords: LonLat[]): [number, number, number, number] | null {
  if (!coords.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}

/** Stable short key for coords + size (FNV-1a over rounded coordinates). */
export function hashCoords(coords: LonLat[], width = SNAP_W, height = SNAP_H): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  feed(`${width}x${height}:${coords.length}`);
  for (const [x, y] of decimate(coords, 200)) feed(`${x.toFixed(5)},${y.toFixed(5)};`);
  return h.toString(36);
}

const mem = new Map<string, string>();
const MEM_MAX = 60;
let queue: Promise<unknown> = Promise.resolve();
let rig: { map: import("maplibre-gl").Map; el: HTMLElement } | null = null;

async function getRig(w: number, h: number) {
  if (rig) return rig;
  const [maplibregl, worker] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl-worker.mjs?url")]);
  maplibregl.setWorkerUrl(worker.default);
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px;pointer-events:none;visibility:hidden`;
  document.body.appendChild(el);
  const map = new maplibregl.Map({
    container: el, style: STYLE, interactive: false, attributionControl: false, fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true }, pixelRatio: 2, center: [103.82, 1.35], zoom: 10,
  } as ConstructorParameters<typeof maplibregl.Map>[0]);
  await new Promise<void>((res, rej) => { map.once("load", () => res()); map.once("error", (e) => rej(e.error ?? e)); });
  const empty = { type: "FeatureCollection" as const, features: [] };
  map.addSource("snap-line", { type: "geojson", data: empty });
  map.addSource("snap-pts", { type: "geojson", data: empty });
  map.addLayer({ id: "snap-casing", type: "line", source: "snap-line", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FFFFFF", "line-width": 8 } });
  map.addLayer({ id: "snap-line", type: "line", source: "snap-line", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#17804F", "line-width": 4.5 } });
  map.addLayer({ id: "snap-pts", type: "circle", source: "snap-pts", paint: { "circle-radius": 6, "circle-color": ["get", "c"], "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2.5 } });
  rig = { map, el };
  return rig;
}

async function render(coords: LonLat[], w: number, h: number): Promise<Blob> {
  const { map } = await getRig(w, h);
  const line = decimate(coords, 400);
  (map.getSource("snap-line") as import("maplibre-gl").GeoJSONSource).setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } });
  (map.getSource("snap-pts") as import("maplibre-gl").GeoJSONSource).setData({
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { c: "#17804F" }, geometry: { type: "Point", coordinates: line[0] } },
      { type: "Feature", properties: { c: "#1D2A23" }, geometry: { type: "Point", coordinates: line[line.length - 1] } },
    ],
  });
  const b = boundsOf(line)!;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 36, animate: false, maxZoom: 17 });
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("snapshot timeout")), 15000);
    map.once("idle", () => { clearTimeout(t); res(); });
    map.triggerRepaint();
  });
  return new Promise((res, rej) => map.getCanvas().toBlob((bl) => (bl ? res(bl) : rej(new Error("toBlob"))), "image/jpeg", 0.82));
}

async function cacheGet(key: string): Promise<Blob | null> {
  try { const r = await (await caches.open(CACHE_NAME)).match(`/__snap/${key}`); return r ? await r.blob() : null; } catch { return null; }
}
async function cachePut(key: string, blob: Blob) {
  try { await (await caches.open(CACHE_NAME)).put(`/__snap/${key}`, new Response(blob, { headers: { "content-type": "image/jpeg" } })); } catch { /* optional */ }
}

/** A JPEG object URL of the basemap with the route on it, or null if it couldn't be drawn. */
export function snapshot(coords: LonLat[], opts: SnapshotOpts = {}): Promise<string | null> {
  if (coords.length < 2 || typeof document === "undefined") return Promise.resolve(null);
  const w = opts.width ?? SNAP_W, h = opts.height ?? SNAP_H;
  const key = hashCoords(coords, w, h);
  const hit = mem.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    if (mem.get(key)) return mem.get(key)!;
    let blob = await cacheGet(key);
    if (!blob) { blob = await render(coords, w, h); void cachePut(key, blob); }
    const url = URL.createObjectURL(blob);
    if (mem.size >= MEM_MAX) { const old = mem.keys().next().value!; URL.revokeObjectURL(mem.get(old)!); mem.delete(old); }
    mem.set(key, url);
    return url;
  }).catch(() => null);
  queue = job;
  return job;
}
