import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dailyLoads, fitnessSeries, goalProgress, periodRange, rideLoad, sgDay, weekdayOf, weekLog, type RideLike,
} from "../src/fitness.ts";

const day = (iso: string) => sgDay(Date.parse(iso));
let n = 0;
const ride = (riddenAt: string, extra: Partial<RideLike> = {}): RideLike => ({
  id: String(n++), riddenAt, distanceM: 10_000, timeS: 2400, stats: { movingS: 1800 }, ...extra,
});

test("rideLoad prefers load, then effort, then RPE x moving minutes, else null", () => {
  assert.equal(rideLoad(ride("2026-11-02T01:00:00Z", { stats: { movingS: 1800, load: 40, effort: 30 }, rpe: 5 })), 40);
  assert.equal(rideLoad(ride("2026-11-02T01:00:00Z", { stats: { movingS: 1800, effort: 30 }, rpe: 5 })), 30);
  assert.equal(rideLoad(ride("2026-11-02T01:00:00Z", { rpe: 6 })), 0.5 * 6 * 30);
  assert.equal(rideLoad(ride("2026-11-02T01:00:00Z", { stats: null, rpe: 4, timeS: 3600 })), 0.5 * 4 * 60);
  assert.equal(rideLoad(ride("2026-11-02T01:00:00Z")), null);
});

test("days follow the Singapore calendar", () => {
  // 17:00 UTC is 01:00 the next day in Singapore.
  assert.equal(day("2026-11-01T17:00:00Z"), day("2026-11-02T00:00:00Z"));
  assert.notEqual(day("2026-11-01T15:59:00Z"), day("2026-11-01T16:00:00Z"));
  assert.equal(weekdayOf(day("2026-11-02T01:00:00Z")), 0); // Monday
  assert.equal(weekdayOf(day("2026-11-08T01:00:00Z")), 6); // Sunday
  const loads = dailyLoads([ride("2026-11-01T17:00:00Z", { rpe: 2 }), ride("2026-11-02T01:00:00Z", { rpe: 2 })]);
  assert.equal(loads.size, 1);
  assert.equal([...loads.values()][0], 60);
});

test("Fitness, Fatigue and Form follow the exponential averages", () => {
  const d0 = day("2026-11-02T01:00:00Z");
  const rides = [ride("2026-11-02T01:00:00Z", { stats: { movingS: 1, load: 84 } })];
  const s = fitnessSeries(rides, d0, d0 + 2);
  assert.equal(s.length, 3);
  assert.equal(s[0].form, 0);
  assert.ok(Math.abs(s[0].fitness - 84 / 42) < 1e-9);
  assert.ok(Math.abs(s[0].fatigue - 84 / 7) < 1e-9);
  assert.equal(s[0].rides, true);
  // Form on a day is the previous day's Fitness minus Fatigue.
  assert.ok(Math.abs(s[1].form - (s[0].fitness - s[0].fatigue)) < 1e-9);
  // A rest day decays: X = X - X/N.
  assert.ok(Math.abs(s[1].fatigue - s[0].fatigue * (1 - 1 / 7)) < 1e-9);
  assert.ok(Math.abs(s[1].fitness - s[0].fitness * (1 - 1 / 42)) < 1e-9);
  assert.equal(s[1].rides, false);
  assert.deepEqual(fitnessSeries([ride("2026-11-02T01:00:00Z")], d0, d0 + 2), []);
});

test("rides before the window still count toward the averages", () => {
  const d0 = day("2026-11-02T01:00:00Z");
  const rides = [ride("2026-10-01T01:00:00Z", { stats: { movingS: 1, load: 100 } })];
  const s = fitnessSeries(rides, d0, d0);
  assert.equal(s.length, 1);
  assert.ok(s[0].fitness > 0 && s[0].fitness < 100 / 42);
});

test("weekLog groups Monday to Sunday and totals each week", () => {
  const today = day("2026-11-12T01:00:00Z"); // Thursday
  const weeks = weekLog([
    ride("2026-11-09T01:00:00Z"), ride("2026-11-09T09:00:00Z", { distanceM: 5000, stats: { movingS: 600 } }),
    ride("2026-11-08T01:00:00Z"), // the Sunday before
  ], today, 3);
  assert.equal(weeks.length, 3);
  assert.equal(weekdayOf(weeks[2].start), 0);
  assert.equal(weeks[2].days.length, 7);
  assert.equal(weeks[2].rides, 2);
  assert.equal(weeks[2].distanceM, 15_000);
  assert.equal(weeks[2].movingS, 2400);
  assert.equal(weeks[2].days[0].rides.length, 2);
  assert.equal(weeks[1].days[6].rides.length, 1);
  assert.equal(weeks[0].rides, 0);
});

test("period ranges and goal progress", () => {
  const today = day("2026-11-12T01:00:00Z");
  assert.deepEqual(periodRange("week", today), [today - 3, today + 3]);
  assert.deepEqual(periodRange("month", today), [day("2026-11-01T01:00:00Z"), day("2026-11-30T01:00:00Z")]);
  assert.deepEqual(periodRange("year", today), [day("2026-01-01T01:00:00Z"), day("2026-12-31T01:00:00Z")]);
  const rides = [
    ride("2026-11-03T01:00:00Z", { distanceM: 62_000 }), ride("2026-10-31T01:00:00Z", { distanceM: 40_000 }),
    ride("2026-11-10T01:00:00Z", { distanceM: 1000, stats: { movingS: 5400 } }),
  ];
  const km = goalProgress({ id: "a", period: "month", metric: "distance", target: 100 }, rides, today);
  assert.equal(km.value, 63);
  assert.equal(km.fraction, 0.63);
  assert.equal(goalProgress({ id: "b", period: "month", metric: "rides", target: 2 }, rides, today).fraction, 1);
  assert.equal(goalProgress({ id: "c", period: "week", metric: "time", target: 3 }, rides, today).value, 1.5);
  assert.equal(goalProgress({ id: "d", period: "year", metric: "distance", target: 1000 }, rides, today).value, 103);
});
