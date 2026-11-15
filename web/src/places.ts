/** Human place names for points ("Bukit Panjang MRT", "Springleaf Nature Park"), from Kayuh's own POIs. */
import { haversine, type LonLat, type Poi } from "@kayuh/router";
import { router } from "./routerClient.ts";

interface Place { lon: number; lat: number; name: string; kind: "mrt" | "park" | "hawker" }

let places: Promise<Place[]> | null = null;

function load(): Promise<Place[]> {
  return (places ??= router.pois().then((pois: Poi[]) => {
    const out: Place[] = [];
    for (const p of pois) {
      const n = (p.n ?? "").trim();
      if (!n) continue;
      if (p.k === "mrt") out.push({ lon: p.lon, lat: p.lat, name: n, kind: "mrt" });
      // "Bedok South Road Blk 16 (Bedok Food Centre)" → "Bedok Food Centre"
      else if (p.k === "hawker") out.push({ lon: p.lon, lat: p.lat, name: n.match(/\(([^)]+)\)\s*$/)?.[1] ?? n, kind: "hawker" });
      // "NParks rack · Springleaf Nature Park (Pcn)" → "Springleaf Nature Park"
      else if (p.k === "parking" && (p as Poi & { t?: string }).t === "NParks rack") {
        out.push({ lon: p.lon, lat: p.lat, name: n.replace(/^.*?·\s*/, "").replace(/\s*\([^)]*\)\s*/g, " ").trim(), kind: "park" });
      }
    }
    return out;
  }).catch(() => []));
}

/** The best short name for a point, or null if there's nothing recognisable nearby. */
export async function placeName([lon, lat]: LonLat): Promise<string | null> {
  const all = await load();
  let best: { p: Place; score: number } | null = null, town: { p: Place; d: number } | null = null;
  for (const p of all) {
    const d = haversine(lon, lat, p.lon, p.lat);
    // A station is a better landmark than a food centre at the same distance.
    const reach = p.kind === "mrt" ? 500 : p.kind === "park" ? 400 : 250;
    if (d <= reach && (!best || d / reach < best.score)) best = { p, score: d / reach };
    if (p.kind === "mrt" && d <= 4000 && (!town || d < town.d)) town = { p, d };
  }
  if (best) return best.p.kind === "mrt" ? `${best.p.name} MRT` : best.p.name;
  return town?.p.name ?? null;
}

/** Labels that say nothing about where a ride went. */
const GENERIC = /^(my location|near my location|dropped pin|here|start|end|finish|stop \d+|loop start|back to start)$/i;

/**
 * A ride title like "Bukit Panjang → Springleaf Nature Park": keeps the names the rider chose,
 * replaces generic ones ("My location") with the nearest landmark to that end of the ride.
 */
export async function rideTitle(name: string, start: LonLat | undefined, end: LonLat | undefined): Promise<string> {
  const parts = name.split("→").map((s) => s.trim());
  if (parts.length !== 2 || !start || !end) return name;
  const [a, b] = await Promise.all([
    GENERIC.test(parts[0]) ? placeName(start) : parts[0],
    GENERIC.test(parts[1]) ? placeName(end) : parts[1],
  ]);
  return `${a ?? parts[0]} → ${b ?? parts[1]}`;
}
