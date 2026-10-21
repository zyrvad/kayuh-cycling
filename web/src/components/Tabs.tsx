import { useEffect, useState } from "preact/hooks";
import { api, type Ride, type SavedRoute } from "../api.ts";
import {
  loopKm, mode, points, routerInfo, savedRouteId, screen, settings, showToast, updateSettings, type Settings,
} from "../state.ts";
import { duration, km, OPERATOR_NAMES } from "../util.ts";
import { Page, TabBar, TierBar } from "./common.tsx";
import { Trash } from "./Icons.tsx";

export function openSaved(r: SavedRoute) {
  // Saved loops carry their corners as stops, so every saved route replays as a fixed A-to-B.
  mode.value = r.mode === "freeform" ? "freeform" : "ab";
  const isLoop = r.mode === "loop";
  const endLabel = isLoop ? "Back to start" : r.name.split("→").pop()!.trim() || "End";
  points.value = r.points.map((ll, i) => ({
    ll, label: i === 0 ? (isLoop ? "Loop start" : "Start") : i === r.points.length - 1 ? endLabel : isLoop ? `Loop point ${i}` : `Stop ${i}`,
  }));
  loopKm.value = Math.max(4, Math.round(r.distanceM / 1000));
  savedRouteId.value = r.id;
  screen.value = "plan";
}

function useLoad<T>(load: () => Promise<T>): [T | null, string | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => load().then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, []);
  return [data, error, reload];
}

export function RoutesTab() {
  const [routes, error, reload] = useLoad(api.routes);
  return (
    <>
      <Page title="Saved routes">
        {error && <div class="banner warn">{error}</div>}
        {routes?.length === 0 && <p class="muted">Routes you save or share show up here.</p>}
        <ul class="list">
          {routes?.map((r) => (
            <li key={r.id} class="list-card">
              <button class="list-main" onClick={() => openSaved(r)}>
                <strong>{r.name}</strong>
                <span class="muted">{km(r.distanceM)} km · {duration(r.timeS)} · {r.legs} leg{r.legs > 1 ? "s" : ""}{r.shareToken ? " · shared" : ""}</span>
                <TierBar tierM={r.tierM} height={6} />
              </button>
              <button class="mini-btn" aria-label={`Delete ${r.name}`} onClick={async () => {
                if (!confirm(`Delete "${r.name}"?`)) return;
                await api.deleteRoute(r.id).catch((e) => showToast(e.message));
                reload();
              }}><Trash /></button>
            </li>
          ))}
        </ul>
      </Page>
      <TabBar />
    </>
  );
}

export function RidesTab() {
  const [rides, error, reload] = useLoad(api.rides);
  const total = (rides ?? []).reduce((a, r) => a + r.distanceM, 0);
  const pcn = (rides ?? []).reduce((a, r) => a + r.tierM[0], 0);
  const toggle = async (r: Ride) => {
    await api.setRideVisibility(r.id, r.visibility === "private" ? "crew" : "private").catch((e) => showToast(e.message));
    reload();
  };
  return (
    <>
      <Page title="Your rides">
        {error && <div class="banner warn">{error}</div>}
        <div class="stat-tiles">
          <div><span class="big">{km(total)}</span><small>km ridden</small></div>
          <div><span class="big">{km(pcn)}</span><small>km on park connectors</small></div>
          <div><span class="big">{rides?.length ?? 0}</span><small>rides</small></div>
        </div>
        <p class="muted small">Rides are private. Share one with your crew when crews arrive.</p>
        <ul class="list">
          {rides?.map((r) => (
            <li key={r.id} class="list-card">
              <div class="list-main">
                <strong>{r.name}</strong>
                <span class="muted">{new Date(r.riddenAt).toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" })} · {km(r.distanceM)} km · {duration(r.timeS)}</span>
                <TierBar tierM={r.tierM} height={6} />
              </div>
              <button class="pill-btn" aria-pressed={r.visibility === "crew"} onClick={() => toggle(r)}>{r.visibility === "crew" ? "Crew" : "Private"}</button>
              <button class="mini-btn" aria-label={`Delete ${r.name}`} onClick={async () => {
                if (!confirm("Delete this ride?")) return;
                await api.deleteRide(r.id).catch((e) => showToast(e.message));
                reload();
              }}><Trash /></button>
            </li>
          ))}
        </ul>
      </Page>
      <TabBar />
    </>
  );
}

export function CrewTab() {
  return (
    <>
      <Page title="Crew">
        <div class="empty-state">
          <strong class="lg">Crews and group rides are coming</strong>
          <p class="muted">Soon you'll invite friends with a link, plan a ride together with a meeting point that has legal parking, and see whose free ride runs out first.</p>
          <p class="muted">For now, plan a route and tap <strong>Share</strong>: anyone can open the link, no account needed.</p>
        </div>
      </Page>
      <TabBar />
    </>
  );
}

function Slider({ label, k, min, max, step, format }: { label: string; k: keyof Settings; min: number; max: number; step: number; format: (v: number) => string }) {
  const v = settings.value[k] as number;
  return (
    <label class="setting">
      <span class="row between"><span>{label}</span><strong>{format(v)}</strong></span>
      <input type="range" min={min} max={max} step={step} value={v}
        onChange={(e) => updateSettings({ [k]: Number((e.target as HTMLInputElement).value) } as Partial<Settings>)} />
    </label>
  );
}

export function MeTab() {
  const s = settings.value;
  const info = routerInfo.value;
  const aversion = (v: number) => (v < 0.25 ? "Don't mind" : v < 0.6 ? "Avoid a bit" : v < 0.85 ? "Avoid" : "Avoid hard");
  return (
    <>
      <Page title="Settings">
        <section class="group">
          <h2>Your bike</h2>
          <div class="segmented" role="group" aria-label="Bike">
            {(Object.keys(OPERATOR_NAMES) as Settings["operator"][]).map((o) => (
              <button key={o} class={s.operator === o ? "seg active" : "seg"} aria-pressed={s.operator === o} onClick={() => updateSettings({ operator: o })}>
                {OPERATOR_NAMES[o]}
              </button>
            ))}
          </div>
          {s.operator !== "own" && (
            <Slider label="Free minutes per ride (your pass)" k="capMinutes" min={15} max={60} step={5} format={(v) => `${v} min`} />
          )}
          <Slider label="Cruising speed" k="speedKmh" min={8} max={25} step={1} format={(v) => `${v} km/h`} />
        </section>
        <section class="group">
          <h2>Route preferences</h2>
          <Slider label="Footpaths" k="footpathAversion" min={0} max={1} step={0.05} format={aversion} />
          <Slider label="Traffic lights and crossings" k="crossingAversion" min={0} max={1} step={0.05} format={aversion} />
          <p class="muted small">Roads are always a last resort. Expressways are never used.</p>
        </section>
        <section class="group">
          <h2>Account</h2>
          <p class="muted small">Your routes and rides are saved to this device's Kayuh ID. Sign-in to sync across devices is coming with crews.</p>
        </section>
        <section class="group">
          <h2>Data</h2>
          <p class="muted small">
            Paths from OpenStreetMap, matched against NParks park connectors and LTA/URA cycling paths. Parking from LTA and OpenStreetMap.
            {info ? ` ${info.nodes.toLocaleString()} path junctions, built ${info.built}.` : " Loading…"}
          </p>
        </section>
      </Page>
      <TabBar />
    </>
  );
}
