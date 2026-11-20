/**
 * Phone screenshots of the running app via headless Chrome and the DevTools Protocol.
 * Dependency-free (Node 22: global fetch and WebSocket).
 *
 *   node web/scripts/screens.mjs --base http://127.0.0.1:8791 --out docs/brand/screens/before \
 *        --shots web/scripts/shots.before.json [--only name]
 *
 * A shots file is a list of { name, steps: [...] }. Steps:
 *   {localStorage:{k:v}}        set before the page loads (null removes the key)
 *   {goto:"/path"}              load a page (the first step of a shot defaults to goto "/")
 *   {click:"css"}               click the first visible match
 *   {clickText:"text"}          click the smallest visible element whose text is exactly that (case-insensitive; falls back to contains)
 *   {eval:"js"}                 run in the page (awaited)
 *   {wait:ms}  {waitFor:"css"}  pause / wait for a selector to appear
 *   {scroll:{selector,y}}       set scrollTop of an element ("window" for the page); y may be "end"
 * Every shot starts fresh with kayuh.devEmail=jaden@kayuh.dev, kayuh.onboarded=1, kayuh.tourDone=1 and a load of "/".
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:8791").replace(/\/$/, "");
const OUT = arg("--out", "docs/brand/screens/out");
const SHOTS = arg("--shots", "web/scripts/shots.before.json");
const ONLY = arg("--only", null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms))]);

const freePort = () => new Promise((res) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

/** Minimal CDP client over one page websocket. */
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; ws.onmessage = (m) => this.onMsg(JSON.parse(m.data)); }
  onMsg(m) {
    if (m.id && this.pending.has(m.id)) { const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else this.handlers.forEach((h) => h(m));
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return withTimeout(new Promise((res, rej) => this.pending.set(id, { res, rej })), 30000, method);
  }
  /** Evaluate in the page and return the value (throws on exceptions). */
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}

async function launch() {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "kayuh-chrome-"));
  const proc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank",
  ], { stdio: "ignore" });
  const cleanup = () => { try { proc.kill("SIGKILL"); } catch {} try { rmSync(dir, { recursive: true, force: true }); } catch {} };
  process.on("exit", cleanup);
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return { cleanup, wsUrl: page.webSocketDebuggerUrl };
    } catch {}
    await sleep(250);
  }
  cleanup();
  throw new Error("Chrome did not start");
}

const DEFAULT_LS = { "kayuh.devEmail": "jaden@kayuh.dev", "kayuh.onboarded": "1", "kayuh.tourDone": "1" };

/** Page-side helper: find a visible element by text and return its centre, or null. */
const findText = (text) => `(() => {
  const want = ${JSON.stringify(text.toLowerCase())};
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const all = [...document.querySelectorAll("body *")].filter(vis);
  const txt = (el) => (el.innerText || "").trim().toLowerCase().replace(/\\s+/g, " ");
  for (const exact of [true, false]) {
    const hits = all.filter((el) => (exact ? txt(el) === want : txt(el).includes(want)));
    // the deepest match is the real label; prefer one inside a button/link if present
    const deepest = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
    if (deepest.length) { const el = deepest[0]; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }
  }
  return null;
})()`;
const findCss = (sel) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];
})()`;

async function tap(cdp, xy, what) {
  if (!xy) throw new Error(`nothing to click: ${what}`);
  const [x, y] = xy;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
    if (type === "mousePressed") await sleep(40);
  }
}

async function waitFor(cdp, expr, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cdp.eval(expr).catch(() => false)) return; await sleep(200); }
  throw new Error(`timeout waiting for ${what}`);
}

async function runStep(cdp, step, state) {
  if ("localStorage" in step) Object.assign(state.ls, step.localStorage);
  else if ("goto" in step) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: lsScript(state.ls) }).then((r) => state.scripts.push(r.identifier));
    await cdp.send("Page.navigate", { url: BASE + step.goto });
    await waitFor(cdp, `document.readyState === "complete" && !!document.querySelector(".tabbar, .onboarding, #app > *")`, 20000, "page load");
    state.loaded = true;
  }
  else if ("click" in step) await tap(cdp, await cdp.eval(findCss(step.click)), step.click);
  else if ("clickText" in step) await tap(cdp, await cdp.eval(findText(step.clickText)), `"${step.clickText}"`);
  else if ("eval" in step) await cdp.eval(step.eval);
  else if ("wait" in step) await sleep(step.wait);
  else if ("waitFor" in step) await waitFor(cdp, `!!document.querySelector(${JSON.stringify(step.waitFor)})`, 20000, step.waitFor);
  else if ("scroll" in step) {
    const { selector, y } = step.scroll;
    await cdp.eval(`(() => { const el = ${selector === "window" ? "document.scrollingElement" : `document.querySelector(${JSON.stringify(selector)})`};
      if (!el) throw new Error("no element ${selector}"); el.scrollTop = ${y === "end" ? "el.scrollHeight" : Number(y)}; })()`);
  }
  else throw new Error(`unknown step ${JSON.stringify(step)}`);
}

const lsScript = (ls) => `try { ${Object.entries(ls).map(([k, v]) => v === null ? `localStorage.removeItem(${JSON.stringify(k)});` : `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(String(v))});`).join(" ")} } catch (e) {}`;

async function main() {
  // Numbering follows the position in the shots file, so --only keeps the same file names.
  const shots = JSON.parse(readFileSync(SHOTS, "utf8")).map((s, i) => ({ ...s, no: i + 1 })).filter((s) => !ONLY || s.name === ONLY);
  if (!shots.length) throw new Error("no shots selected");
  mkdirSync(OUT, { recursive: true });
  // A full run replaces the folder's PNGs (so renamed or reordered shots leave nothing stale).
  if (!ONLY) for (const f of readdirSync(OUT)) if (/^\d\d-.*\.png$/.test(f)) rmSync(join(OUT, f));
  const { cleanup, wsUrl } = await launch();
  let failed = 0;
  try {
    const ws = new WebSocket(wsUrl);
    await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); }), 10000, "ws open");
    const cdp = new Cdp(ws);
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" });
    for (const shot of shots) {
      const file = join(OUT, `${String(shot.no).padStart(2, "0")}-${shot.name}.png`);
      const state = { ls: { ...DEFAULT_LS }, scripts: [], loaded: false };
      try {
        await withTimeout((async () => {
          await cdp.send("Page.navigate", { url: "about:blank" });
          const steps = [...shot.steps];
          // localStorage steps come first; make sure there is a load.
          if (!steps.some((s) => "goto" in s)) steps.splice(steps.findIndex((s) => !("localStorage" in s)) < 0 ? steps.length : steps.findIndex((s) => !("localStorage" in s)), 0, { goto: "/" });
          for (const step of steps) await runStep(cdp, step, state);
          await sleep(300);
          const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(file, Buffer.from(data, "base64"));
        })(), 90000, `shot ${shot.name}`);
        console.log(`ok   ${file}`);
      } catch (e) { failed++; console.log(`FAIL ${shot.name}: ${e.message}`); }
      finally { for (const id of state.scripts) await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: id }).catch(() => {}); }
    }
    ws.close();
  } finally { cleanup(); }
  console.log(`${shots.length - failed}/${shots.length} shots saved to ${OUT}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
