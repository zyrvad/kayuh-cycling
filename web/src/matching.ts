/**
 * Matched rides: the same trip ridden again, found by route shape (so it works for recorded and imported
 * rides that were never planned). Pure, no DOM; used by the ride page.
 */
import { haversine, type LonLat } from "@kayuh/router";
import { decodePolyline } from "./util.ts";

export const MATCH = { distanceFrac: 0.15, endsM: 300, lineM: 60, share: 0.85, samples: 100 };

export interface Matchable { id: string; polyline: string; distanceM: number }

/** At most `n` points spread evenly along the line, always keeping the first and last. */
export function sample(pts: LonLat[], n = MATCH.samples): LonLat[] {
  if (pts.length <= n) return pts;
  return Array.from({ length: n }, (_, i) => pts[Math.round((i * (pts.length - 1)) / (n - 1))]);
}

/** Distance in metres from `p` to the segment a-b (local flat projection: fine at ride scale). */
export function pointToSegmentM(p: LonLat, a: LonLat, b: LonLat): number {
  const k = Math.cos((p[1] * Math.PI) / 180), m = 111_320;
  const ax = (a[0] - p[0]) * k * m, ay = (a[1] - p[1]) * m, bx = (b[0] - p[0]) * k * m, by = (b[1] - p[1]) * m;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + u * dx, ay + u * dy);
}

/** Share (0-1) of `pts` that lie within `withinM` of the line. */
function covered(pts: LonLat[], line: LonLat[], withinM: number): number {
  if (!pts.length || !line.length) return 0;
  let hit = 0;
  for (const p of pts) {
    let near = line.length === 1 ? haversine(p[0], p[1], line[0][0], line[0][1]) : Infinity;
    for (let i = 1; i < line.length && near > withinM; i++) near = Math.min(near, pointToSegmentM(p, line[i - 1], line[i]));
    if (near <= withinM) hit++;
  }
  return hit / pts.length;
}

/** True when two lines are the same trip: similar ends, and each stays on the other's line. */
export function sameShape(a: LonLat[], b: LonLat[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  const near = (p: LonLat, q: LonLat) => haversine(p[0], p[1], q[0], q[1]) <= MATCH.endsM;
  if (!near(a[0], b[0]) || !near(a[a.length - 1], b[b.length - 1])) return false;
  return covered(sample(a), b, MATCH.lineM) >= MATCH.share && covered(sample(b), a, MATCH.lineM) >= MATCH.share;
}

/** The other rides that are the same trip as `ride` (distance within 15%, then ends, then shape). */
export function matchedRides<T extends Matchable>(ride: Matchable, all: T[]): T[] {
  const line = decodePolyline(ride.polyline);
  return all.filter((r) =>
    r.id !== ride.id && ride.distanceM > 0 && Math.abs(r.distanceM - ride.distanceM) <= ride.distanceM * MATCH.distanceFrac
    && sameShape(line, decodePolyline(r.polyline)));
}
