/** Encoded polylines (precision 5) and privacy trimming for shared rides. */

type LonLat = [number, number];

export function decodePolyline(s: string): LonLat[] {
  const out: LonLat[] = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let shift = 0, result = 0, b: number;
    do {
      if (i >= s.length) throw new Error("bad polyline");
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next();
    lon += next();
    out.push([lon / 1e5, lat / 1e5]);
  }
  return out;
}

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

function metres(a: LonLat, b: LonLat): number {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.hypot(x, y) * 6371008.8;
}

/** Cut `m` metres off one end of a line (the start), interpolating the new first point. */
function trimStart(coords: LonLat[], m: number): LonLat[] {
  let left = m;
  for (let i = 1; i < coords.length; i++) {
    const d = metres(coords[i - 1], coords[i]);
    if (d >= left) {
      const f = left / d;
      const a = coords[i - 1], b = coords[i];
      return [[a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], ...coords.slice(i)];
    }
    left -= d;
  }
  return [];
}

/**
 * The privacy trim for rides shown to a crew: drop the first and last `m` metres so the line
 * doesn't lead to someone's home. Rides too short to survive the trim show no line at all.
 */
export function trimEnds(polyline: string, m = 200): string {
  let coords: LonLat[];
  try {
    coords = decodePolyline(polyline);
  } catch {
    return "";
  }
  const head = trimStart(coords, m);
  const both = trimStart(head.reverse(), m).reverse();
  return both.length >= 2 ? encodePolyline(both) : "";
}
