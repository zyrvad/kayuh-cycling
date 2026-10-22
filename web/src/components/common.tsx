import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { authHeaders } from "../api.ts";
import { screen, type Screen } from "../state.ts";
import { TIER_COLORS, TIER_SHORT } from "../util.ts";
import { TabCrew, TabMap, TabMe, TabRides, TabRoutes } from "./Icons.tsx";

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
  { id: "discover", label: "Map", icon: TabMap },
  { id: "routes", label: "Routes", icon: TabRoutes },
  { id: "crew", label: "Crew", icon: TabCrew },
  { id: "rides", label: "Rides", icon: TabRides },
  { id: "me", label: "Me", icon: TabMe },
];

export function TabBar() {
  return (
    <nav class="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <button key={t.id} class={screen.value === t.id ? "tab active" : "tab"} aria-current={screen.value === t.id ? "page" : undefined}
          onClick={() => (screen.value = t.id)}>
          <t.icon />
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export function Page({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="page" aria-label={title}>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

/**
 * A bottom sheet you can collapse by dragging its handle down (or tapping it), leaving `peek`
 * pixels visible, and expand again by dragging up or tapping.
 */
export function Sheet({ class: cls, peek, children }: { class: string; peek: number; children: ComponentChildren }) {
  const [collapsed, setCollapsed] = useState(false);
  const [dy, setDy] = useState<number | null>(null);

  const onDown = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    let last = 0;
    const move = (ev: PointerEvent) => {
      last = ev.clientY - startY;
      setDy(last);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDy(null);
      if (Math.abs(last) < 6) setCollapsed((c) => !c); // a tap toggles
      else if (last > 50) setCollapsed(true);
      else if (last < -50) setCollapsed(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const drag = dy ?? 0;
  const transform = collapsed
    ? `translateY(calc(100% - ${peek}px + ${Math.min(0, drag)}px))`
    : `translateY(${Math.max(0, drag)}px)`;
  return (
    <div class={`${cls}${collapsed ? " collapsed" : ""}`} style={{ transform, transition: dy === null ? "transform 220ms ease" : "none" }}>
      <button class="sheet-grip" aria-label={collapsed ? "Expand panel" : "Collapse panel"} aria-expanded={!collapsed}
        onPointerDown={onDown} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCollapsed(!collapsed); } }}>
        <span class="handle" />
      </button>
      {children}
    </div>
  );
}

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
