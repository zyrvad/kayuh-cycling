import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { requestCompass } from "../heading.ts";
import { locate, settings, updateSettings, type Settings } from "../state.ts";
import { startTour } from "../tour.ts";
import { TOUR_KEY, tourSteps } from "../tourSteps.ts";
import { OPERATOR_NAMES } from "../util.ts";
import { Locate, Needle } from "./Icons.tsx";
import "./onboarding.css";

const KEY = "kayuh.onboarded";

export function isOnboarded(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/** True while the welcome cards are on screen. Settings "Show welcome again" sets it. */
export const showOnboarding = signal(!isOnboarded());

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => (navigator as any).standalone === true || window.matchMedia("(display-mode: standalone)").matches;

function close() {
  try { localStorage.setItem(KEY, "1"); } catch { /* storage unavailable: it will show again next time */ }
  showOnboarding.value = false;
}

const CARDS = 3;

export function Onboarding() {
  const [i, setI] = useState(0);
  const last = i === CARDS - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, CARDS - 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tour = () => {
    close();
    // let the cards unmount first so the tour measures the real screen
    setTimeout(() => startTour(tourSteps(), { key: TOUR_KEY }), 60);
  };

  return (
    <div class="onb" role="dialog" aria-modal="true" aria-label="Welcome to Kayuh">
      <div class="onb-top">
        <div class="onb-dots" role="img" aria-label={`Card ${i + 1} of ${CARDS}`}>
          {Array.from({ length: CARDS }, (_, n) => <span key={n} class={n === i ? "onb-dot on" : "onb-dot"} />)}
        </div>
        <button class="onb-skip" onClick={close}>Skip</button>
      </div>
      <div class="onb-clip"><div class="onb-track" style={{ transform: `translateX(-${i * 100}%)` }}>
        <Card on={i === 0} art={<ArtPaths />} title="Ride Singapore's park connectors">
          <p>Kayuh plans routes along park connectors and cycling paths. Roads are only the last resort.</p>
        </Card>
        <Card on={i === 1} art={<ArtLegs />} title="30-minute legs, legal parking">
          <p>Long rides split into legs that fit your free rental minutes. Each leg ends at LTA bike parking, so no $5 fine.</p>
          <Bike />
        </Card>
        <Card on={i === 2} art={<ArtCompass />} title="Where you are and which way you face">
          <Location />
        </Card>
      </div></div>
      <div class="onb-nav">
        {!last && <>
          <button class="btn primary" onClick={() => setI(i + 1)}>Next</button>
          {i > 0 && <button class="btn outline" onClick={() => setI(i - 1)}>Back</button>}
        </>}
        {last && <>
          <button class="btn primary" onClick={tour}>Show me around</button>
          <button class="btn onb-tertiary" onClick={close}>Not now</button>
        </>}
      </div>
    </div>
  );
}

function Card({ on, art, title, children }: { on: boolean; art: preact.ComponentChildren; title: string; children: preact.ComponentChildren }) {
  return (
    <section class="onb-card" aria-hidden={on ? undefined : "true"} inert={!on}>
      <div class="onb-art" aria-hidden="true">{art}</div>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

function ArtPaths() {
  return (
    <svg viewBox="0 0 240 160" width="100%" height="100%" role="presentation">
      <rect x="0" y="0" width="240" height="160" rx="24" fill="var(--accent-soft)" />
      <path d="M14 128 L226 120" stroke="var(--line-2)" stroke-width="10" stroke-linecap="round" fill="none" />
      <path d="M26 118 C70 120 70 60 112 70 S 160 128 214 38" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none" />
      <path d="M26 118 C70 120 70 60 112 70 S 160 128 214 38" stroke="#fff" stroke-width="2.5" stroke-dasharray="1 9" stroke-linecap="round" fill="none" />
      <circle cx="26" cy="118" r="10" fill="#fff" stroke="var(--accent)" stroke-width="5" />
      <circle cx="214" cy="38" r="10" fill="var(--accent-deep)" stroke="#fff" stroke-width="4" />
    </svg>
  );
}

function ArtLegs() {
  return (
    <svg viewBox="0 0 240 160" width="100%" height="100%" role="presentation">
      <rect x="0" y="0" width="240" height="160" rx="24" fill="var(--accent-soft)" />
      <path d="M30 110 C 70 40, 110 140, 120 80" stroke="var(--accent)" stroke-width="10" stroke-linecap="round" fill="none" />
      <path d="M120 80 C 135 20, 190 60, 212 44" stroke="var(--accent-deep)" stroke-width="10" stroke-linecap="round" fill="none" />
      {[[30, 110], [120, 80], [212, 44]].map(([x, y]) => (
        <g key={x}>
          <circle cx={x} cy={y} r="17" fill="#fff" stroke="var(--accent)" stroke-width="4" />
          <text x={x} y={y + 6} text-anchor="middle" font-size="18" font-weight="800" fill="var(--accent-ink)" font-family="Figtree, system-ui, sans-serif">P</text>
        </g>
      ))}
      <text x="62" y="36" font-size="15" font-weight="800" fill="var(--accent-ink)" font-family="Figtree, system-ui, sans-serif">30 min</text>
      <text x="150" y="132" font-size="15" font-weight="800" fill="var(--accent-ink)" font-family="Figtree, system-ui, sans-serif">30 min</text>
    </svg>
  );
}

function ArtCompass() {
  return (
    <svg viewBox="0 0 240 160" width="100%" height="100%" role="presentation">
      <rect x="0" y="0" width="240" height="160" rx="24" fill="var(--accent-soft)" />
      <circle cx="120" cy="80" r="62" fill="#fff" stroke="var(--line-2)" stroke-width="3" />
      <circle cx="120" cy="80" r="44" fill="none" stroke="var(--accent-light)" stroke-width="2" stroke-dasharray="3 6" />
      <text x="120" y="34" text-anchor="middle" font-size="15" font-weight="800" fill="var(--accent-ink)" font-family="Figtree, system-ui, sans-serif">N</text>
      <g transform="translate(120 80) rotate(35) translate(-30 -30)" style={{ color: "var(--accent)" }}><Needle size={60} /></g>
    </svg>
  );
}

function Bike() {
  const s = settings.value;
  return (
    <div class="onb-bike">
      <div class="segmented" role="group" aria-label="Bike">
        {(Object.keys(OPERATOR_NAMES) as Settings["operator"][]).map((o) => (
          <button key={o} class={s.operator === o ? "seg active" : "seg"} aria-pressed={s.operator === o} onClick={() => updateSettings({ operator: o })}>
            {OPERATOR_NAMES[o]}
          </button>
        ))}
      </div>
      <span class="muted small">{s.operator === "own" ? "Your own bike has no time limit." : `Your pass: first ${s.capMinutes} min of each ride free. Change it in Settings.`}</span>
    </div>
  );
}

function Location() {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [loc, setLoc] = useState(false);
  const [compass, setCompass] = useState(false);
  const allow = async () => {
    setState("busy");
    // both calls start in the tap, because iOS only allows the compass prompt from a user gesture
    const [l, c] = await Promise.all([locate().then(Boolean).catch(() => false), requestCompass().then((r) => r === "granted").catch(() => false)]);
    setLoc(l); setCompass(c); setState("done");
  };
  return (
    <>
      <p>Kayuh starts routes from where you are, finds parking nearby and turns the map to the way you face. Nothing leaves your device.</p>
      {state !== "done" && <button class="btn primary" disabled={state === "busy"} onClick={allow}>{state === "busy" ? "Asking..." : "Allow location"}</button>}
      {state === "done" && (
        <div class="onb-note" role="status">
          <div><Locate size={16} /> Location: {loc ? "on" : "off. Turn it on later in Settings."}</div>
          <div>Compass: {compass ? "on" : "off. The map will point north."}</div>
        </div>
      )}
      {isIOS() && !isStandalone() && (
        <div class="onb-note"><strong>Tip:</strong> tap Share, then Add to Home Screen, to open Kayuh full screen.</div>
      )}
    </>
  );
}
