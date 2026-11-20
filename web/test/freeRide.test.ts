import assert from "node:assert/strict";
import { test } from "node:test";
import { addFix, freeSecondsLeft, isWarn, movingSeconds, newFreeRide, pause, resume, rideName, tooShort } from "../src/freeRide.ts";

test("addFix ignores jitter and poor accuracy", () => {
  let r = addFix(0, null, [103.9, 1.3], 5);
  assert.deepEqual(r.last, [103.9, 1.3]);
  assert.equal(addFix(0, r.last, [103.9 + 0.00001, 1.3], 5).counted, false); // ~1 m
  assert.equal(addFix(0, r.last, [103.91, 1.3], 50).counted, false); // bad accuracy
  r = addFix(0, r.last, [103.9 + 0.0003, 1.3], 10); // ~33 m
  assert.ok(r.counted && r.distanceM > 30 && r.distanceM < 36);
});

test("moving time excludes pauses", () => {
  let s = newFreeRide(0, 30);
  s = pause(s, 60_000);
  assert.equal(movingSeconds(s, 100_000), 60);
  s = resume(s, 100_000);
  assert.equal(s.pausedMs, 40_000);
  assert.equal(movingSeconds(s, 160_000), 120);
  assert.equal(resume(s, 1), s);
});

test("free minutes left", () => {
  assert.equal(freeSecondsLeft(null, 100), null);
  assert.equal(freeSecondsLeft(30, 600), 1200);
  assert.equal(isWarn(301), false);
  assert.equal(isWarn(300), true);
  assert.equal(isWarn(-5), true);
  assert.equal(isWarn(null), false);
});

test("too short and names", () => {
  assert.ok(tooShort(99)); assert.ok(!tooShort(100));
  assert.equal(rideName(new Date(2026, 0, 1, 7)), "Morning ride");
  assert.equal(rideName(new Date(2026, 0, 1, 15)), "Afternoon ride");
  assert.equal(rideName(new Date(2026, 0, 1, 18)), "Evening ride");
});
