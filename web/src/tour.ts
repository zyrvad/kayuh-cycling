import { signal } from "@preact/signals";
import { screen, type Screen } from "./state.ts";

export type TourStep = { sel: string; title: string; text: string; screen?: Screen; before?: () => void };
export type TourRect = { x: number; y: number; w: number; h: number };
export type TourState = { steps: TourStep[]; i: number };

/** The running tour, or null. The TourLayer component renders from this. */
export const tourState = signal<TourState | null>(null);
/** Viewport rect of the current target (null while waiting for it to appear). */
export const tourRect = signal<TourRect | null>(null);

const WAIT_MS = 1500;
let opts: { key?: string; onDone?: () => void } = {};
let token = 0;
let cleanup: (() => void) | null = null;
let el: Element | null = null;

const usable = (e: Element | null): e is Element => {
  if (!e) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

function waitFor(sel: string, t: number): Promise<Element | null> {
  return new Promise((resolve) => {
    const probe = () => document.querySelector(sel);
    if (usable(probe())) return resolve(probe());
    let done = false;
    const finish = (r: Element | null) => {
      if (done) return;
      done = true;
      mo.disconnect();
      clearTimeout(timer);
      resolve(r);
    };
    const check = () => { if (t !== token) return finish(null); if (usable(probe())) finish(probe()); };
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => finish(null), WAIT_MS);
    const tick = () => { if (done) return; check(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

function measure() {
  if (!el || !el.isConnected) return;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  tourRect.value = { x: r.left, y: r.top, w: r.width, h: r.height };
}

let ro: ResizeObserver | null = null;
async function goTo(i: number, dir: 1 | -1) {
  const t = ++token;
  const st = tourState.value;
  if (!st) return;
  let n = i;
  while (n >= 0 && n < st.steps.length) {
    const step = st.steps[n];
    tourRect.value = null;
    ro?.disconnect();
    el = null;
    tourState.value = { steps: st.steps, i: n };
    try {
      if (step.screen && screen.value !== step.screen) screen.value = step.screen;
      step.before?.();
    } catch { /* a bad hook must not kill the tour */ }
    const found = await waitFor(step.sel, t);
    if (t !== token) return;
    if (found) {
      el = found;
      found.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(found);
      return;
    }
    n += dir;
  }
  // ran off the end: finishing forwards counts as done, running off the start stays on the first step that works
  if (dir === 1) endTour(true);
  else goTo(0, 1);
}

export function startTour(steps: TourStep[], o: { key?: string; onDone?: () => void } = {}) {
  endTour();
  if (!steps.length) return;
  opts = o;
  if (o.key) { try { localStorage.setItem(o.key, "1"); } catch { /* storage blocked */ } }
  tourState.value = { steps, i: 0 };

  let raf = 0;
  const reposition = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); endTour(); }
    else if (e.key === "ArrowRight") tourNext();
    else if (e.key === "ArrowLeft") tourBack();
  };
  window.addEventListener("resize", reposition);
  window.addEventListener("orientationchange", reposition);
  window.addEventListener("scroll", reposition, true);
  document.addEventListener("keydown", onKey);
  cleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", reposition);
    window.removeEventListener("orientationchange", reposition);
    window.removeEventListener("scroll", reposition, true);
    document.removeEventListener("keydown", onKey);
  };
  void goTo(0, 1);
}

export function tourNext() {
  const st = tourState.value;
  if (!st) return;
  if (st.i >= st.steps.length - 1) endTour(true);
  else void goTo(st.i + 1, 1);
}

export function tourBack() {
  const st = tourState.value;
  if (st && st.i > 0) void goTo(st.i - 1, -1);
}

/** Close the tour. `done` true runs onDone (Done button), false is a skip. */
export function endTour(done = false) {
  const was = tourState.value;
  token++;
  ro?.disconnect();
  ro = null;
  el = null;
  cleanup?.();
  cleanup = null;
  tourState.value = null;
  tourRect.value = null;
  const cb = opts.onDone;
  opts = {};
  if (was && done && cb) cb();
}

/** Run the tour once per device (flag in localStorage under `key`). */
export function autoStartTour(steps: TourStep[], key: string, o: { onDone?: () => void } = {}) {
  try { if (localStorage.getItem(key)) return; } catch { /* storage blocked: still show */ }
  startTour(steps, { ...o, key });
}
