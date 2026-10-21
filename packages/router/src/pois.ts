import { haversine } from "./geo.ts";

export type PoiKind = "parking" | "water" | "toilet" | "hawker" | "mrt" | "bike_shop";

/** A point of interest as written by pipeline/build.py (pois.json). */
export interface Poi {
  k: PoiKind;
  lon: number;
  lat: number;
  /** Name (may be empty). */
  n: string;
  /** Source: lta | osm | nea. */
  s: string;
  /** 1 if sheltered/covered. */
  c: number;
  /** Graph node it was snapped to. */
  node: number;
  /** Metres from the POI to that node. */
  walk: number;
  /** Index in the list, assigned on load. */
  id?: number;
}

const CELL = 0.005; // ~550 m

/** Small spatial index over POIs. */
export class PoiIndex {
  readonly all: Poi[];
  private cells = new Map<string, Poi[]>();

  constructor(pois: Poi[]) {
    this.all = pois.map((p, i) => ({ ...p, id: i }));
    for (const p of this.all) {
      const key = `${Math.floor(p.lon / CELL)}:${Math.floor(p.lat / CELL)}`;
      let bucket = this.cells.get(key);
      if (!bucket) this.cells.set(key, (bucket = []));
      bucket.push(p);
    }
  }

  /** POIs within `radiusM` of a point, nearest first. */
  near(lon: number, lat: number, radiusM: number, kind?: PoiKind): { poi: Poi; dist: number }[] {
    const r = Math.ceil(radiusM / 500);
    const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
    const out: { poi: Poi; dist: number }[] = [];
    for (let x = cx - r; x <= cx + r; x++) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (const p of this.cells.get(`${x}:${y}`) ?? []) {
          if (kind && p.k !== kind) continue;
          const d = haversine(lon, lat, p.lon, p.lat);
          if (d <= radiusM) out.push({ poi: p, dist: d });
        }
      }
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  /** Amenities (not parking) within `radiusM`, one entry per kind. */
  amenitiesNear(lon: number, lat: number, radiusM = 150): PoiKind[] {
    const kinds = new Set<PoiKind>();
    for (const { poi } of this.near(lon, lat, radiusM)) if (poi.k !== "parking") kinds.add(poi.k);
    return [...kinds];
  }
}
