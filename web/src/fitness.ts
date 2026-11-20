/** Training maths for the Training view: daily load, Fitness / Fatigue / Form, weekly totals and goal progress. Pure. */

import { minOf } from "./util.ts";

/** The parts of a ride this needs (a `Ride` from api.ts fits). */
export interface RideLike {
  id: string;
  riddenAt: string;
  distanceM: number;
  timeS: number;
  stats?: { movingS: number; effort?: number; load?: number } | null;
  rpe?: number | null;
}

export type GoalPeriod = "week" | "month" | "year";
export type GoalMetric = "distance" | "time" | "rides";
export interface Goal { id: string; period: GoalPeriod; metric: GoalMetric; target: number }

const DAY_MS = 86_400_000;
/** Singapore is UTC+8 all year, no daylight saving. */
const SG_MS = 8 * 3_600_000;

/** Days since 1970-01-01 on the Singapore calendar. All "day" numbers below are these. */
export const sgDay = (ms: number) => Math.floor((ms + SG_MS) / DAY_MS);
export const dayStartMs = (day: number) => day * DAY_MS - SG_MS;
/** 0 = Monday ... 6 = Sunday (day 0, 1 Jan 1970, was a Thursday). */
export const weekdayOf = (day: number) => (((day + 3) % 7) + 7) % 7;
const civil = (day: number) => new Date(day * DAY_MS); // read with the getUTC* methods
export const dayDate = (day: number) => civil(day);

export const movingS = (r: RideLike) => r.stats?.movingS ?? r.timeS;

/** Relative Effort of a ride: the saved load, else the saved effort, else a guess from the rider's rating. */
export function rideLoad(r: RideLike): number | null {
  const s = r.stats;
  if (s?.load != null) return s.load;
  if (s?.effort != null) return s.effort;
  if (r.rpe) return 0.5 * r.rpe * (movingS(r) / 60);
  return null;
}

export const ridesWithLoad = (rides: RideLike[]) => rides.filter((r) => rideLoad(r) !== null).length;

/** Total load per Singapore day. */
export function dailyLoads(rides: RideLike[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rides) {
    const l = rideLoad(r);
    if (l === null) continue;
    const d = sgDay(Date.parse(r.riddenAt));
    m.set(d, (m.get(d) ?? 0) + l);
  }
  return m;
}

export interface FitnessPoint { day: number; load: number; fitness: number; fatigue: number; form: number; rides: boolean }

export const FITNESS_DAYS = 42;
export const FATIGUE_DAYS = 7;

/**
 * Fitness (42-day average of load), Fatigue (7-day) and Form (yesterday's Fitness minus Fatigue) for
 * each day from `from` to `to`. Both averages start at 0 on the first day with any load, so a
 * ride's effect builds up as it would in a real log.
 */
export function fitnessSeries(rides: RideLike[], from: number, to: number): FitnessPoint[] {
  const loads = dailyLoads(rides);
  if (!loads.size) return [];
  const first = minOf(loads.keys());
  let ctl = 0, atl = 0;
  const out: FitnessPoint[] = [];
  for (let d = Math.min(first, from); d <= to; d++) {
    const load = loads.get(d) ?? 0;
    const form = ctl - atl;
    if (d >= first) {
      ctl += (load - ctl) / FITNESS_DAYS;
      atl += (load - atl) / FATIGUE_DAYS;
    }
    if (d >= from) out.push({ day: d, load, fitness: ctl, fatigue: atl, form, rides: loads.has(d) });
  }
  return out;
}

export interface DayLog<R extends RideLike = RideLike> { day: number; distanceM: number; movingS: number; rides: R[] }
export interface WeekLog<R extends RideLike = RideLike> { start: number; days: DayLog<R>[]; distanceM: number; movingS: number; rides: number }

/** The `count` weeks (Monday to Sunday) up to and including the one with `today`, oldest first. */
export function weekLog<R extends RideLike>(rides: R[], today: number, count = 12): WeekLog<R>[] {
  const thisMonday = today - weekdayOf(today);
  const byDay = new Map<number, R[]>();
  for (const r of rides) {
    const d = sgDay(Date.parse(r.riddenAt));
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const weeks: WeekLog<R>[] = [];
  for (let w = count - 1; w >= 0; w--) {
    const start = thisMonday - 7 * w;
    const days: DayLog<R>[] = [];
    for (let i = 0; i < 7; i++) {
      const rs = byDay.get(start + i) ?? [];
      days.push({ day: start + i, rides: rs, distanceM: sum(rs, (r) => r.distanceM), movingS: sum(rs, movingS) });
    }
    weeks.push({
      start, days, distanceM: sum(days, (d) => d.distanceM), movingS: sum(days, (d) => d.movingS), rides: sum(days, (d) => d.rides.length),
    });
  }
  return weeks;
}

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

/** First and last day (inclusive) of the week, month or year containing `today`. */
export function periodRange(period: GoalPeriod, today: number): [number, number] {
  if (period === "week") {
    const start = today - weekdayOf(today);
    return [start, start + 6];
  }
  const d = civil(today);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const [a, b] = period === "month" ? [Date.UTC(y, m, 1), Date.UTC(y, m + 1, 1)] : [Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)];
  return [a / DAY_MS, b / DAY_MS - 1];
}

export interface GoalProgress { value: number; target: number; fraction: number; unit: string }

/** Progress so far this week, month or year, in the goal's own unit (km, hours or rides). */
export function goalProgress(goal: Goal, rides: RideLike[], today: number): GoalProgress {
  const [from, to] = periodRange(goal.period, today);
  const inside = rides.filter((r) => {
    const d = sgDay(Date.parse(r.riddenAt));
    return d >= from && d <= to;
  });
  const value = goal.metric === "distance" ? sum(inside, (r) => r.distanceM) / 1000
    : goal.metric === "time" ? sum(inside, movingS) / 3600 : inside.length;
  return { value, target: goal.target, fraction: Math.min(1, value / goal.target), unit: goal.metric === "distance" ? "km" : goal.metric === "time" ? "h" : "rides" };
}
