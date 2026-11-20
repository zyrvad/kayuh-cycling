import assert from "node:assert/strict";
import test from "node:test";
import type { LonLat } from "@kayuh/router";
import { boundsOf, decimate, hashCoords } from "../src/mapSnapshot.ts";

const line: LonLat[] = Array.from({ length: 1000 }, (_, i) => [103.8 + i * 1e-4, 1.3 + Math.sin(i / 50) * 1e-2]);

test("decimate keeps ends and caps length", () => {
  const d = decimate(line, 100);
  assert.equal(d.length, 100);
  assert.deepEqual(d[0], line[0]);
  assert.deepEqual(d[99], line[999]);
  assert.equal(decimate(line.slice(0, 5), 100).length, 5);
});
test("boundsOf", () => {
  assert.deepEqual(boundsOf([[1, 2], [3, 0], [2, 5]]), [1, 0, 3, 5]);
  assert.equal(boundsOf([]), null);
});
test("hashCoords is stable and sensitive", () => {
  assert.equal(hashCoords(line), hashCoords([...line]));
  assert.notEqual(hashCoords(line), hashCoords(line.slice(1)));
  assert.notEqual(hashCoords(line, 640, 360), hashCoords(line, 320, 180));
});
