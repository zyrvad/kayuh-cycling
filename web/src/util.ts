import type { LonLat } from "@kayuh/router";

/** Google encoded polyline, precision 5. */
export function encodePolyline(coords: LonLat[]): string {
  let out = "", pLat = 0, pLon = 0;
  const enc = (v: number) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of coords) {
    const la = Math.round(lat * 1e5), lo = Math.round(lon * 1e5);
    enc(la - pLat);
    enc(lo - pLon);
    pLat = la;
    pLon = lo;
  }
  return out;
}

export function decodePolyline(s: string): LonLat[] {
  const out: LonLat[] = [];
  let i = 0, lat = 0, lon = 0;
  const dec = () => {
    let shift = 0, result = 0, b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += dec();
    lon += dec();
    out.push([lon / 1e5, lat / 1e5]);
  }
  return out;
}

export const km = (m: number) => (m >= 10000 ? (m / 1000).toFixed(0) : (m / 1000).toFixed(1));

export function duration(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`;
}

export const clock = (s: number) => {
  const neg = s < 0;
  s = Math.abs(Math.round(s));
  return `${neg ? "-" : ""}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const timeOfDay = (d: Date) => d.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });

/** Sunset for a date at a location (NOAA approximation, good to a minute or two). */
export function sunset(date: Date, lat = 1.35, lon = 103.82): Date {
  const rad = Math.PI / 180;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start) / 86400000);
  const g = (2 * Math.PI / 365) * (day - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g);
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)) / rad;
  const minutesUtc = 720 - 4 * (lon - ha) - eqt;
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(d.getTime() + minutesUtc * 60000);
}

export const TIER_LABELS = ["Park connector", "Cycling path", "Shared path", "Footpath", "Quiet road", "Road"];
export const TIER_SHORT = ["PCN", "Cycling path", "Shared", "Footpath", "Quiet road", "Road"];
export const TIER_COLORS = ["#17804F", "#2E6BD1", "#6DB98A", "#9AA39E", "#C9A227", "#D9541E"];

export const OPERATOR_NAMES = { helloride: "HelloRide", anywheel: "Anywheel", own: "Own bike" } as const;

/**
 * App colours follow your bike: HelloRide blue, Anywheel green, Kayuh green for your own bike.
 * Only the UI accent changes; map tier colours keep their meaning for everyone.
 */
export const THEMES = {
  helloride: { accent: "#1D63D8", deep: "#164FAD", soft: "#E7EFFC", ink: "#123E88", light: "#B8D0F7" },
  anywheel: { accent: "#12804A", deep: "#0B5E35", soft: "#E5F3EA", ink: "#0B4A2B", light: "#B5E3C8" },
  own: { accent: "#17804F", deep: "#0F5E39", soft: "#E8F3EC", ink: "#0F4D30", light: "#B9E6CB" },
} as const;
