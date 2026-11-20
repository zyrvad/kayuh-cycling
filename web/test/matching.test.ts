import assert from "node:assert/strict";
import { test } from "node:test";
import type { LonLat } from "@kayuh/router";
import { matchedRides, pointToSegmentM, sameShape, sample } from "../src/matching.ts";
import { encodePolyline } from "../src/util.ts";

/** A line heading east from (103.8, 1.35), one point every ~11 m, `n` points, shifted north by `northM`. */
const line = (n: number, northM = 0, lon0 = 103.8): LonLat[] =>
  Array.from({ length: n }, (_, i) => [lon0 + i * 0.0001, 1.35 + northM / 111_320] as LonLat);
const ride = (id: string, pts: LonLat[], distanceM: number) => ({ id, polyline: encodePolyline(pts), distanceM });

test("point to segment: across, along and beyond the ends", () => {
  const a: LonLat = [103.8, 1.35], b: LonLat = [103.81, 1.35];
  assert.ok(Math.abs(pointToSegmentM([103.805, 1.35 + 50 / 111_320], a, b) - 50) < 1);
  assert.ok(pointToSegmentM([103.805, 1.35], a, b) < 0.5);
  const past = pointToSegmentM([103.811, 1.35], a, b);
  assert.ok(past > 100 && past < 125, `past the end: ${past}`);
});

test("sample keeps the ends and at most n points", () => {
  const pts = line(1000);
  const s = sample(pts, 100);
  assert.equal(s.length, 100);
  assert.deepEqual(s[0], pts[0]);
  assert.deepEqual(s[99], pts[999]);
  assert.equal(sample(line(5), 100).length, 5);
});

test("same trip with a little GPS drift matches; a parallel line 100 m away doesn't", () => {
  assert.equal(sameShape(line(200), line(200, 25)), true);
  assert.equal(sameShape(line(200), line(200, 100)), false);
});

test("a ride that shares only the start (then goes elsewhere) doesn't match", () => {
  const a = line(200);
  const b = [...line(100), ...Array.from({ length: 100 }, (_, i) => [103.81 + i * 0.00001, 1.35 + (i + 1) * 0.0001] as LonLat)];
  assert.equal(sameShape(a, b), false);
});

test("a short ride along the start of a longer one doesn't match (the long one strays off the short line)", () => {
  assert.equal(sameShape(line(200), line(100)), false);
});

test("start and end must be within 300 m", () => {
  assert.equal(sameShape(line(200), line(200, 0, 103.8 + 0.004)), false);
});

test("matchedRides filters by distance, excludes itself and keeps the shape matches", () => {
  const me = ride("me", line(200), 2000);
  const all = [
    me,
    ride("same", line(200, 15), 2100),
    ride("far", line(200, 15), 2600),          // distance 30% off
    ride("elsewhere", line(200, 400), 2000),   // right length, other place
    ride("again", line(200, -20), 1800),       // exactly 10% shorter
  ];
  assert.deepEqual(matchedRides(me, all).map((r) => r.id).sort(), ["again", "same"]);
  assert.deepEqual(matchedRides(ride("none", [], 0), all), []);
});
