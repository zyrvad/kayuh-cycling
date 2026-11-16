import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { requestCompass } from "../heading.ts";
import { locate, settings, updateSettings, type Settings } from "../state.ts";
import { OPERATOR_NAMES } from "../util.ts";
import "./onboarding.css";

const KEY = "kayuh.onboarded";

export function isOnboarded(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** True while the intro is on screen. MeTab's "Replay intro" sets it. */
export const showOnboarding = signal(!isOnboarded());

// Chrome on Android fires this once; keep it so the install step can offer a button.
type InstallEvent = Event & { prompt: () => Promise<void> };
let installEvent: InstallEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e as InstallEvent; });
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => (navigator as any).standalone === true || window.matchMedia("(display-mode: standalone)").matches;

type StepId = "welcome" | "bike" | "location" | "iphone" | "install" | "friends";

function steps(): StepId[] {
  const list: StepId[] = ["welcome", "bike", "location"];
  if (isIOS()) list.push("iphone");
  if (!isStandalone() && (isIOS() || installEvent)) list.push("install");
  list.push("friends");
  return list;
}

function close() {
  try { localStorage.setItem(KEY, "1"); } catch { /* storage unavailable: it will show again next time */ }
  showOnboarding.value = false;
}

export function Onboarding() {
  const [list] = useState(steps);
  const [i, setI] = useState(0);
  const step = list[i];
  const last = i === list.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class="onb" role="dialog" aria-modal="true" aria-label="Welcome to Kayuh">
      <div class="onb-card">
        <div class="onb-top">
          <div class="onb-dots" role="img" aria-label={`Step ${i + 1} of ${list.length}`}>
            {list.map((s, n) => <span key={s} class={n === i ? "onb-dot on" : "onb-dot"} />)}
          </div>
          <button class="onb-skip" onClick={close}>Skip</button>
        </div>
        {step === "welcome" && <Welcome />}
        {step === "bike" && <Bike />}
        {step === "location" && <Location />}
        {step === "iphone" && <IPhone />}
        {step === "install" && <Install />}
        {step === "friends" && <Friends />}
        <div class="onb-nav">
          {i > 0 && <button class="btn outline" onClick={() => setI(i - 1)}>Back</button>}
          <button class="btn primary" onClick={() => (last ? close() : setI(i + 1))}>{last ? "Start exploring" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}

function Welcome() {
  return (
    <>
      <h1>Welcome to Kayuh</h1>
      <p class="muted">A cycling route planner built for Singapore.</p>
      <ul>
        <li>Routes stay on park connectors and cycling paths, with roads only as a last resort.</li>
        <li>Long rides are split into legs that fit your free rental minutes.</li>
        <li>Every stop ends at legal bike parking, so no $5 fine.</li>
      </ul>
    </>
  );
}

function Bike() {
  const s = settings.value;
  return (
    <>
      <h1>Your bike</h1>
      <p class="muted">Kayuh plans around what you ride. You can change this any time in Settings.</p>
      <div class="segmented" role="group" aria-label="Bike">
        {(Object.keys(OPERATOR_NAMES) as Settings["operator"][]).map((o) => (
          <button key={o} class={s.operator === o ? "seg active" : "seg"} aria-pressed={s.operator === o} onClick={() => updateSettings({ operator: o })}>
            {OPERATOR_NAMES[o]}
          </button>
        ))}
      </div>
      {s.operator !== "own" && (
        <label class="setting">
          <span class="row between"><span>Free minutes per ride</span><strong>{s.capMinutes} min</strong></span>
          <input type="range" min={15} max={60} step={5} value={s.capMinutes}
            onInput={(e) => updateSettings({ capMinutes: Number((e.target as HTMLInputElement).value) })} />
          <span class="muted small">Check your pass. Kayuh starts a new leg before this runs out.</span>
        </label>
      )}
    </>
  );
}

function Location() {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "denied">("idle");
  const allow = async () => {
    setState("busy");
    setState((await locate()) ? "ok" : "denied");
  };
  return (
    <>
      <h1>Your location</h1>
      <p class="muted">Kayuh uses it to start routes from where you are, find parking nearby and follow you during a ride. It stays on your device.</p>
      {state !== "ok" && <button class="btn primary" disabled={state === "busy"} onClick={allow}>{state === "busy" ? "Locating…" : "Allow location"}</button>}
      {state === "ok" && <div class="onb-note" role="status">Location is on. You are all set.</div>}
      {state === "denied" && <div class="onb-note" role="status">No problem. You can turn it on later in Settings.</div>}
    </>
  );
}

function IPhone() {
  const [compass, setCompass] = useState<"idle" | "ok" | "no">("idle");
  return (
    <>
      <h1>Riding on iPhone</h1>
      <p class="muted">Let the map turn with you, so up on the screen is the way you are heading.</p>
      {compass !== "ok" && <button class="btn primary" onClick={() => requestCompass().then((ok) => setCompass(ok ? "ok" : "no"))}>Let the map turn with me</button>}
      {compass === "ok" && <div class="onb-note" role="status">The map can now turn as you ride.</div>}
      {compass === "no" && <div class="onb-note" role="status">Compass access was not allowed. The map will stay pointing north.</div>}
      <div class="onb-note">
        <strong>Tip:</strong> if an "Undo Typing" popup appears while you ride, turn off Settings &gt; Accessibility &gt; Touch &gt; Shake to Undo.
      </div>
    </>
  );
}

function Install() {
  const [done, setDone] = useState(false);
  return (
    <>
      <h1>Add to home screen</h1>
      <p class="muted">Kayuh opens full screen from your home screen, like an app.</p>
      {isIOS() ? (
        <ol>
          <li>Tap the Share button in Safari.</li>
          <li>Scroll down and tap Add to Home Screen.</li>
          <li>Tap Add.</li>
        </ol>
      ) : installEvent && !done ? (
        <button class="btn primary" onClick={() => installEvent!.prompt().catch(() => {}).finally(() => { installEvent = null; setDone(true); })}>Install Kayuh</button>
      ) : (
        <div class="onb-note" role="status">Done. Look for Kayuh on your home screen.</div>
      )}
    </>
  );
}

function Friends() {
  return (
    <>
      <h1>Ride with friends</h1>
      <ul>
        <li>Make a crew, share routes with it and plan group rides together.</li>
        <li>A group ride uses the strictest free-minutes limit among its riders.</li>
        <li>Sign in to keep your routes and rides on every device.</li>
      </ul>
    </>
  );
}
