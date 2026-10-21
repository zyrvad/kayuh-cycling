import { simplifyLine, type LonLat } from "./geo.ts";
import type { RouteResult } from "./plan.ts";

/** Watches choke on long tracks (Huawei/Zepp import), so keep it under this many points. */
const MAX_POINTS = 1500;

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n: number) => n.toFixed(6);

/** GPX 1.1 with the route as a track and every leg end as a named waypoint. */
export function toGpx(route: RouteResult, name: string): string {
  let tol = 2;
  let pts: LonLat[] = simplifyLine(route.coords, tol);
  while (pts.length > MAX_POINTS && tol < 60) {
    tol *= 1.6;
    pts = simplifyLine(route.coords, tol);
  }
  const wpts = route.legs.map((leg, i) => {
    const last = i === route.legs.length - 1;
    const label = last ? `Finish: ${leg.to.name || "destination"}` : `P${i + 1} park: ${leg.to.name}`;
    return `  <wpt lat="${fmt(leg.to.lat)}" lon="${fmt(leg.to.lon)}"><name>${esc(label)}</name><sym>${last ? "Flag" : "Parking Area"}</sym></wpt>`;
  });
  const start = route.legs[0]?.from;
  if (start) wpts.unshift(`  <wpt lat="${fmt(start.lat)}" lon="${fmt(start.lon)}"><name>${esc(`Start: ${start.name || "start"}`)}</name><sym>Flag</sym></wpt>`);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="Kayuh" xmlns="http://www.topografix.com/GPX/1/1">`,
    `  <metadata><name>${esc(name)}</name></metadata>`,
    ...wpts,
    `  <trk><name>${esc(name)}</name><type>cycling</type><trkseg>`,
    ...pts.map(([lon, lat]) => `    <trkpt lat="${fmt(lat)}" lon="${fmt(lon)}"></trkpt>`),
    `  </trkseg></trk>`,
    `</gpx>`,
    "",
  ].join("\n");
}
