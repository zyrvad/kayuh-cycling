/** Launch screen (#splash in index.html): real progress from the graph download and map load, then a quick fade. */

const CAP_MS = 8000;
const FADE_MS = 240;
/** Once the graph is in, wait at most this long for the map: when Home is the first tab the map may never mount. */
const MAP_GRACE_MS = 500;
let shown = 0;
let hidden = false;

const el = () => document.getElementById("splash");

export function setSplashProgress(f: number): void {
  const s = el();
  if (!s || hidden) return;
  shown = Math.max(shown, Math.min(1, f)); // monotonic
  const fill = document.getElementById("splash-fill");
  if (fill) fill.style.width = `${(shown * 100).toFixed(1)}%`;
  s.setAttribute("aria-valuenow", String(Math.round(shown * 100)));
}

export function hideSplash(): void {
  if (hidden) return;
  hidden = true;
  const s = el();
  const done = () => {
    s?.remove();
    document.documentElement.classList.remove("splash-on");
  };
  if (!s) return done();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
  s.style.pointerEvents = "none";
  s.style.opacity = "0";
  setTimeout(done, FADE_MS + 20);
}

export interface LaunchSources {
  graph: { onProgress: (cb: (f: number) => void) => unknown; done: Promise<unknown> };
  map: { done: Promise<unknown> };
}

/** progress = 0.85 graph + 0.15 map; hides when both are done, after a hard cap, or at once if there is no splash. */
export function trackLaunch({ graph, map }: LaunchSources): void {
  if (!el()) return hideSplash();
  let g = 0;
  let m = 0;
  let gDone = false;
  let mDone = false;
  const update = () => setSplashProgress(0.85 * g + 0.15 * m);
  const check = () => {
    if (!gDone || !mDone) return;
    setSplashProgress(1);
    if (new URLSearchParams(location.search).get("splash") === "hold") return;
    // let the bar reach 100% for a beat before fading
    setTimeout(hideSplash, 120);
  };
  graph.onProgress((f) => { g = Math.max(g, f); update(); });
  const graphIn = () => { gDone = true; setTimeout(() => { mDone = true; check(); }, MAP_GRACE_MS); };
  graph.done.then(() => { g = 1; update(); graphIn(); check(); }, () => { graphIn(); });
  map.done.then(() => { m = 1; mDone = true; update(); check(); }, () => { mDone = true; check(); });
  if (new URLSearchParams(location.search).get("splash") !== "hold") setTimeout(hideSplash, CAP_MS);
}
