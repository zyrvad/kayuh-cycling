import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyse, hrMetrics, hrZoneOf, maxHrFor, perSecond, powerMetrics, powerZoneOf, relativeEffort, summary, trainingLoad, type Sample,
} from "../src/track.ts";

/** A 1 Hz ride heading east at ~20 km/h, with the given heart rate / power at each second. */
function ride(n: number, hr: (i: number) => number | null, power: (i: number) => number | null = () => null): Sample[] {
  return Array.from({ length: n }, (_, i) => ({
    ll: [103.8 + i * 0.00005, 1.3] as [number, number], t: i, alt: null, kmh: 20, tier: -1, hr: hr(i), cad: null, power: power(i),
  }));
}

test("max HR: own value, else from age, else 190 (estimated)", () => {
  assert.deepEqual(maxHrFor({ maxHr: 185, birthYear: 1990 }), { bpm: 185, estimated: false });
  assert.deepEqual(maxHrFor({ birthYear: 1996 }, 2026), { bpm: 187, estimated: true }); // 208 - 0.7 x 30
  assert.deepEqual(maxHrFor({}), { bpm: 190, estimated: true });
  assert.deepEqual(maxHrFor(null), { bpm: 190, estimated: true });
});

test("zone boundaries: Z1 <60%, Z2 60-70, Z3 70-80, Z4 80-90, Z5 >=90%", () => {
  const z = (hr: number) => hrZoneOf(hr, 200);
  assert.deepEqual([119, 120, 139, 140, 159, 160, 179, 180, 200].map(z), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  const pz = (w: number) => powerZoneOf(w, 200);
  assert.deepEqual([109, 110, 149, 150, 179, 180, 209, 210, 239, 240, 299, 300, 500].map(pz), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
});

test("HR zones are time in seconds; avg and max HR", () => {
  // 600 s at 130 (Z2 of 200), 300 s at 190 (Z5).
  const m = hrMetrics(ride(900, (i) => (i < 600 ? 130 : 190)), { maxHr: 200 })!;
  assert.deepEqual(m.hrZones, [0, 600, 0, 0, 300]);
  assert.equal(m.avgHr, 150);
  assert.equal(m.maxHr, 190);
  assert.equal(m.max.estimated, false);
  assert.equal(hrMetrics(ride(60, () => null)), null);
});

test("time weighting: sparse samples hold until the next one, but not across long gaps", () => {
  const s = [0, 4, 8, 12].map((t, i): Sample => ({ ll: [103.8, 1.3], t, alt: null, kmh: null, tier: -1, hr: i < 2 ? 100 : 190, cad: null, power: null }));
  const m = hrMetrics(s, { maxHr: 200 })!;
  // 100 bpm (Z1) for 8 s, then 190 bpm (Z5) for 4 s plus the last sample's 1 s.
  assert.deepEqual(m.hrZones, [8, 0, 0, 0, 5]);
  // A 60 s hole in the readings is not counted as time in a zone.
  const gap = [0, 60].map((t): Sample => ({ ll: [103.8, 1.3], t, alt: null, kmh: null, tier: -1, hr: 150, cad: null, power: null }));
  assert.equal(perSecond(gap, (x) => x.hr).filter((v) => v !== null).length, 11);
});

test("Relative Effort: Edwards TRIMP; RPE fallback; null with neither", () => {
  // 10 min in each zone: 10 x (1+2+3+4+5) = 150.
  assert.equal(relativeEffort([600, 600, 600, 600, 600], null, 3000), 150);
  assert.equal(relativeEffort([0, 0, 0, 0, 0], 5, 1800), 75, "0.5 x 5 x 30 min");
  assert.equal(relativeEffort(null, 6, 3600), 180);
  assert.equal(relativeEffort(null, null, 3600), null);
  assert.equal(relativeEffort(undefined, 0, 3600), null);
  assert.equal(relativeEffort([600, 0, 0, 0, 0], 9, 3600), 10, "heart rate wins over RPE");
  assert.equal(trainingLoad(42), 42);
  assert.equal(trainingLoad(null), null);
});

test("constant power: NP = avg = max = that power; power curve is flat", () => {
  const p = powerMetrics(ride(1300, () => null, () => 200))!;
  assert.deepEqual([p.avgPower, p.maxPower, p.np], [200, 200, 200]);
  assert.deepEqual(p.powerCurve, { 5: 200, 15: 200, 30: 200, 60: 200, 300: 200, 600: 200, 1200: 200 });
  assert.equal(p.tss, undefined, "no FTP, no TSS");
  assert.equal(powerMetrics(ride(100, () => null)), null);
});

test("with FTP: intensity factor, TSS and Coggan zones", () => {
  const p = powerMetrics(ride(3600, () => null, () => 200), 200)!;
  assert.equal(p.intensityFactor, 1);
  assert.equal(p.tss, 100, "an hour at FTP is 100 TSS");
  assert.deepEqual(p.zones, [0, 0, 0, 3600, 0, 0, 0]);
  assert.equal(powerMetrics(ride(1800, () => null, () => 100), 200)!.tss, 13, "30 min at IF 0.5 is 12.5");
});

test("NP weighs hard efforts more than avg; curve finds the best window", () => {
  // 10 min at 100 W, then 5 min at 300 W, then 10 min at 100 W.
  const p = powerMetrics(ride(1500, () => null, (i) => (i >= 600 && i < 900 ? 300 : 100)))!;
  assert.equal(p.avgPower, 140);
  assert.ok(p.np > 180 && p.np < 300, `np ${p.np}`);
  assert.equal(p.powerCurve["300"], 300);
  assert.equal(p.powerCurve["60"], 300);
  assert.equal(p.powerCurve["600"], 200);
  assert.equal(p.powerCurve["1200"], 150, "the 5 min effort plus 15 min at 100 W");
  assert.equal(p.powerCurve["3600"], undefined, "ride shorter than an hour");
});

test("a pause does not join two efforts into one window", () => {
  const s = ride(100, () => null, () => 250);
  const later = ride(100, () => null, () => 250).map((x) => ({ ...x, t: x.t + 300 }));
  const p = powerMetrics([...s, ...later])!;
  assert.equal(p.powerCurve["60"], 250);
  assert.equal(p.powerCurve["300"], undefined, "no unbroken 5 minutes");
});

test("analyse + summary carry the training numbers (and omit them without sensors)", () => {
  const a = analyse(ride(900, () => 140, () => 180), [0], { physiology: { maxHr: 200, ftpW: 200 }, rpe: 5 });
  assert.deepEqual(a.hrZones, [0, 0, 900, 0, 0]);
  assert.equal(a.effort, 45); // 15 min x zone 3
  assert.equal(a.load, 45);
  assert.equal(a.avgHr, 140);
  assert.equal(a.np, 180);
  assert.equal(a.tss, Math.round((900 * 180 * 0.9) / (200 * 3600) * 100));
  const s = summary(a);
  assert.deepEqual([s.avgHr, s.maxHr, s.effort, s.load, s.avgPower, s.maxPower, s.np], [140, 140, 45, 45, 180, 180, 180]);
  assert.deepEqual(s.powerCurve?.["300"], 180);
  const plain = summary(analyse(ride(900, () => null)));
  for (const k of ["avgHr", "hrZones", "effort", "load", "np", "tss", "powerCurve"]) assert.equal(k in plain, false, k);
  // No sensors but an RPE: effort from the rating.
  const rpeOnly = summary(analyse(ride(900, () => null), [0], { rpe: 6 }));
  assert.equal(rpeOnly.effort, Math.round(0.5 * 6 * (rpeOnly.movingS / 60)));
  assert.equal(rpeOnly.load, rpeOnly.effort);
});

test("stats stay valid with a heart-rate spike and a huge time span", () => {
  const s = ride(60, (i) => (i === 30 ? 2999 : 140));
  const m = hrMetrics(s, { maxHr: 200 })!;
  assert.equal(m.maxHr, 140, "a spike outside 25-250 bpm is ignored");
  const far = ride(60, () => 140);
  far[59].t = 4e9; // one outlier timestamp must not allocate billions of slots
  assert.ok(perSecond(far, (x) => x.hr).length <= 48 * 3600 + 1);
  assert.doesNotThrow(() => analyse(far));
});

test("speed by path type counts all steps on a tier, so it matches the tier bar", () => {
  // 600 m on tier 0 sampled every 90 s (>60 s apart, so never "moving"): the distance still counts.
  const s: Sample[] = Array.from({ length: 5 }, (_, i) => ({ ll: [103.8 + i * 0.0014, 1.3] as [number, number], t: i * 90, alt: null, kmh: null, tier: 0, hr: null, cad: null, power: null }));
  const a = analyse(s);
  assert.ok(a.byTier[0] && a.byTier[0].distanceM > 500);
});

// ------------------------------------------------------------------ tier distances and short rides

test("tier bar and per-tier list share one computation, even with gaps over 60 s and several tiers", () => {
  const tiers = [0, 0, 0, 1, 1, 2, 3, 3, 4, 5, 5, 0, 0, 2, 2, 3, -1, -1, 1, 1];
  let t = 0;
  const samples: Sample[] = tiers.map((tier, i) => {
    t += i === 6 || i === 13 ? 120 : 5; // two gaps longer than 60 s
    return { ll: [103.8 + i * 0.0003, 1.3] as [number, number], t, alt: null, kmh: 18, tier, hr: null, cad: null, power: null };
  });
  const a = analyse(samples);
  assert.equal(a.tierM.length, 6);
  // Every tier that has distance is in the list, and the list matches the bar per tier.
  for (let tier = 0; tier < 6; tier++) {
    const row = a.byTier.find((r) => r.tier === tier);
    if (a.tierM[tier] > 0) assert.equal(row?.distanceM, a.tierM[tier], `tier ${tier}`);
    else assert.equal(row, undefined);
  }
  const listSum = a.byTier.reduce((s, r) => s + r.distanceM, 0);
  assert.ok(Math.abs(listSum - a.tierM.reduce((s, m) => s + m, 0)) < 1e-6);
  assert.ok(a.byTier.length >= 5);
  assert.ok(listSum > 0 && listSum <= a.distanceM + 1e-6);
});

test("very short ride: average speed is sane and never above the top speed", () => {
  // ~200 m covered in 9 s of recorded time (GPS jitter) would read as 80 km/h.
  const samples: Sample[] = Array.from({ length: 10 }, (_, i) => ({
    ll: [103.8 + i * 0.0002, 1.3] as [number, number], t: i, alt: null, kmh: null, tier: 0, hr: null, cad: null, power: null,
  }));
  const a = analyse(samples);
  assert.ok(a.avgKmh <= 60);
  assert.ok(a.maxKmh >= a.avgKmh);
});
