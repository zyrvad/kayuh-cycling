import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { authHeaders } from "../api.ts";
import { me, mapBearing, screen, type Screen } from "../state.ts";
import { TIER_COLORS, TIER_SHORT } from "../util.ts";
import { Back, Needle, TabCrew, TabHome, TabMap, TabMe, TabRides, TabRoutes } from "./Icons.tsx";

export function TierBar({ tierM, height = 10, labels = false }: { tierM: number[]; height?: number; labels?: boolean }) {
  const total = tierM.reduce((a, b) => a + b, 0) || 1;
  const parts = tierM.map((m, t) => ({ t, pct: (100 * m) / total })).filter((p) => p.pct > 0.2);
  return (
    <div class="tierbar-wrap">
      <div class="tierbar" style={{ height: `${height}px` }} role="img"
        aria-label={parts.map((p) => `${TIER_SHORT[p.t]} ${Math.round(p.pct)}%`).join(", ")}>
        {parts.map((p) => <span key={p.t} style={{ width: `${p.pct}%`, background: TIER_COLORS[p.t] }} />)}
      </div>
      {labels && (
        <div class="tierbar-labels">
          {parts.filter((p) => p.pct >= 0.5).map((p) => <span key={p.t}>{TIER_SHORT[p.t]} {Math.round(p.pct)}%</span>)}
        </div>
      )}
    </div>
  );
}

const TABS: { id: Screen; label: string; icon: () => preact.JSX.Element }[] = [
  { id: "home", label: "Home", icon: TabHome },
  { id: "discover", label: "Map", icon: TabMap },
  { id: "routes", label: "Routes", icon: TabRoutes },
  { id: "rides", label: "Rides", icon: TabRides },
  { id: "crew", label: "Crew", icon: TabCrew },
];

export function TabBar() {
  return (
    <nav class="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <button key={t.id} class={screen.value === t.id ? "tab active" : "tab"} aria-current={screen.value === t.id ? "page" : undefined} data-tour={`tab-${t.id}`}
          onClick={() => (screen.value = t.id)}>
          <t.icon />
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export function Page({ title, children, back, actions, profile = true }: {
  title: string; children: ComponentChildren; back?: () => void; actions?: ComponentChildren; profile?: boolean;
}) {
  const m = me.value;
  const avatar = profile ? (
    <button class="icon-btn profile" aria-label="Profile" data-tour="profile" onClick={() => (screen.value = "me")}>
      <Avatar name={m?.displayName || m?.email || "Me"} url={m?.avatar} />
    </button>
  ) : null;
  const right = actions || avatar ? <>{actions}{avatar}</> : null;
  if (!back && !right) {
    return (
      <section class="page" aria-label={title}>
        <h1>{title}</h1>
        {children}
      </section>
    );
  }
  return (
    <section class="page" aria-label={title}>
      <div class="page-head">
        {back && <button class="icon-btn" aria-label="Back" onClick={back}><Back /></button>}
        <h1>{title}</h1>
        {right}
      </div>
      {children}
    </section>
  );
}

/**
 * A bottom sheet you can collapse by dragging its handle down (or tapping it), leaving `peek`
 * pixels visible, and expand again by dragging up or tapping.
 */
export { Sheet } from "./Sheet.tsx";

// Pictures are fetched with the app's auth headers (and the browser's HTTP cache), then shown from memory.
const pictures = new Map<string, Promise<string | null>>();
function picture(url: string) {
  let p = pictures.get(url);
  if (!p) {
    p = fetch(url, { headers: authHeaders() })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null);
    pictures.set(url, p);
  }
  return p;
}

/** Someone's profile picture, or their initial until they add one. */
export function Avatar({ name, url, class: cls = "" }: { name: string; url: string | null | undefined; class?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!url) return;
    let live = true;
    picture(url).then((s) => live && setSrc(s));
    return () => { live = false; };
  }, [url]);
  return (
    <span class={`avatar ${cls}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : (name.trim().slice(0, 1).toUpperCase() || "?")}
    </span>
  );
}

/** Centre-crop and shrink a photo to a small square JPEG data URL (about 20 KB). */
export async function squarePhoto(file: File, size = 256): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/**
 * Shows which way is north. Hidden while the map points north, unless `always` (ride mode, where it
 * also switches heading-up on and off).
 */
export function Compass({ onClick, always = false, label = "Point the map north", pressed, class: cls = "" }: {
  onClick: () => void; always?: boolean; label?: string; pressed?: boolean; class?: string;
}) {
  const b = mapBearing.value;
  if (!always && Math.abs(((b + 540) % 360) - 180) < 1) return null;
  return (
    <button class={`icon-btn raised compass ${cls}`} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      <Needle style={{ transform: `rotate(${-b}deg)` }} />
    </button>
  );
}
