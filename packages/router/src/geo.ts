export type LonLat = [number, number];

const R = 6371008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversine(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing in degrees (0 = north, clockwise). */
export function bearing(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const y = Math.sin((bLon - aLon) * RAD) * Math.cos(bLat * RAD);
  const x = Math.cos(aLat * RAD) * Math.sin(bLat * RAD) - Math.sin(aLat * RAD) * Math.cos(bLat * RAD) * Math.cos((bLon - aLon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Signed turn angle from heading a to heading b, in (-180, 180]; positive = right. */
export function turnAngle(a: number, b: number): number {
  let d = b - a;
  while (d <= -180) d += 360;
  while (d > 180) d -= 360;
  return d;
}

/** Point at distance (m) and bearing (deg) from origin. Good enough at SG scale. */
export function offset(lon: number, lat: number, distM: number, bearingDeg: number): LonLat {
  const dLat = (distM * Math.cos(bearingDeg * RAD)) / R / RAD;
  const dLon = (distM * Math.sin(bearingDeg * RAD)) / (R * Math.cos(lat * RAD)) / RAD;
  return [lon + dLon, lat + dLat];
}

/** Douglas-Peucker on lon/lat with a tolerance in metres (local equirectangular projection). */
export function simplifyLine(pts: LonLat[], tolM: number): LonLat[] {
  if (pts.length <= 2) return pts.slice();
  const k = Math.cos(pts[0][1] * RAD) * R * RAD;
  const kLat = R * RAD;
  const xy = pts.map(([lon, lat]) => [lon * k, lat * kLat]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[j];
    const dx = x2 - x1, dy = y2 - y1;
    const norm = Math.hypot(dx, dy) || 1e-9;
    let best = 0, bestK = -1;
    for (let m = i + 1; m < j; m++) {
      const d = Math.abs(dy * xy[m][0] - dx * xy[m][1] + x2 * y1 - y2 * x1) / norm;
      if (d > best) { best = d; bestK = m; }
    }
    if (best > tolM) {
      keep[bestK] = 1;
      stack.push([i, bestK], [bestK, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
