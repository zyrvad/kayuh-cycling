/**
 * Golden routes on the real Singapore graph (web/public/data, built by pipeline/build.py).
 * Expectations come from PLAN.md. Run: npm run golden
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createContext, CYCLEWAY, parseGraph, PCN, planLoops, planRoute, PoiIndex, ROAD, SHARED, type LonLat,
  type RouteResult,
} from "../src/index.ts";

const dataDir = fileURLToPath(new URL("../../../web/public/data/", import.meta.url));
const buf = gunzipSync(readFileSync(dataDir + "graph.bin.gz"));
const graph = parseGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const pois = new PoiIndex(JSON.parse(readFileSync(dataDir + "pois.json", "utf8")).pois);
const ctx = createContext(graph, pois);

const share = (r: RouteResult, ...tiers: number[]) => tiers.reduce((s, t) => s + r.tierM[t], 0) / r.distanceM;
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;

function check(name: string, points: LonLat[], expect: (r: RouteResult) => void) {
  test(name, () => {
    const t0 = performance.now();
    const r = planRoute(ctx, { points, capMinutes: 30 }, "nicest");
    const ms = performance.now() - t0;
    console.log(`  ${name}: ${(r.distanceM / 1000).toFixed(1)} km, ${Math.round(r.timeS / 60)} min, ${r.legs.length} legs, `
      + `pcn ${pct(share(r, PCN))}, nice ${pct(share(r, PCN, CYCLEWAY, SHARED))}, road ${pct(share(r, ROAD))}, `
      + `${r.signals} lights, ${ms.toFixed(0)} ms`);
    // A leg may only run over the free ride where the data has no parking at all (and the route says so).
    const parkingGap = r.warnings.some((w) => w.includes("No legal parking"));
    for (const leg of r.legs) {
      if (leg.overCap && parkingGap) {
        console.log(`  known parking gap: leg to ${leg.to.name} is ${Math.round(leg.timeS / 60)} min`);
        continue;
      }
      assert.ok(!leg.overCap, `leg to ${leg.to.name} is over the free ride (${Math.round(leg.timeS / 60)} min)`);
    }
    assert.ok(r.legs.at(-1)!.to.parking, "route must end at legal parking");
    expect(r);
  });
}

// The coastal PCN around Changi Airport is ~27 km, so the nicest route goes inland via the
// Bedok, Tampines and Loyang park connectors (crossing roads at lights along the way).
check("East Coast Park (Marine Cove) → Changi Village", [[103.9135, 1.3016], [103.9876, 1.3893]], (r) => {
  assert.ok(share(r, PCN, CYCLEWAY) >= 0.7, `pcn+cycleway ${pct(share(r, PCN, CYCLEWAY))}`);
  assert.ok(share(r, ROAD) < 0.02, `road ${pct(share(r, ROAD))}`);
  assert.ok(r.distanceM < 20000, `${r.distanceM} m`);
});

check("East Coast Park → Changi Village via the coast", [[103.9135, 1.3016], [103.9850, 1.3300], [103.9876, 1.3893]], (r) => {
  assert.ok(share(r, PCN, CYCLEWAY) >= 0.85, `pcn+cycleway ${pct(share(r, PCN, CYCLEWAY))}`);
  assert.ok(share(r, ROAD) < 0.02, `road ${pct(share(r, ROAD))}`);
});

check("Punggol Point → Waterway Point", [[103.9105, 1.4190], [103.9020, 1.4067]], (r) => {
  assert.ok(share(r, PCN, CYCLEWAY, SHARED) >= 0.8, `nice ${pct(share(r, PCN, CYCLEWAY, SHARED))}`);
});

check("Rail Corridor: Buona Vista → Bukit Timah Railway Station", [[103.7905, 1.3060], [103.7751, 1.3407]], (r) => {
  assert.ok(share(r, ROAD) < 0.05, `road ${pct(share(r, ROAD))}`);
});

check("Kallang → Marina Barrage → Gardens by the Bay", [[103.8680, 1.3040], [103.8711, 1.2806], [103.8636, 1.2816]], (r) => {
  assert.ok(share(r, ROAD) < 0.05, `road ${pct(share(r, ROAD))}`);
});

check("Tampines MRT → Bedok Reservoir (errand)", [[103.9452, 1.3534], [103.9246, 1.3427]], (r) => {
  assert.ok(share(r, ROAD) < 0.1, `road ${pct(share(r, ROAD))}`);
});

test("Jurong Lake Gardens loop (~6 km)", () => {
  const t0 = performance.now();
  const loops = planLoops(ctx, { start: [103.7290, 1.3398], targetKm: 6, capMinutes: 30 });
  const ms = performance.now() - t0;
  assert.ok(loops.length >= 1);
  for (const r of loops) {
    console.log(`  loop: ${(r.distanceM / 1000).toFixed(1)} km, nice ${pct(share(r, PCN, CYCLEWAY, SHARED))}, road ${pct(share(r, ROAD))}`);
  }
  console.log(`  ${loops.length} loops in ${ms.toFixed(0)} ms`);
  const best = loops[0];
  assert.ok(share(best, PCN, CYCLEWAY, SHARED) >= 0.6, `nice ${pct(share(best, PCN, CYCLEWAY, SHARED))}`);
  assert.ok(best.distanceM > 3500 && best.distanceM < 9500, `${best.distanceM} m`);
});
