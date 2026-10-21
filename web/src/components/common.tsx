import type { ComponentChildren } from "preact";
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
