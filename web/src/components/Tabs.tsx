import { useEffect, useState } from "preact/hooks";
import { api, type SavedRoute } from "../api.ts";
import { loopKm, mode, points, savedRouteId, screen, showToast } from "../state.ts";
import { duration, km } from "../util.ts";
import { Page, TabBar } from "./common.tsx";
import { More, Share, Trash, Watch } from "./Icons.tsx";
import { RouteCard } from "./RouteCard.tsx";
import { ShareSheet } from "./ShareSheet.tsx";

export function openSaved(r: Pick<SavedRoute, "id" | "mode" | "name" | "points" | "distanceM">) {
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
  const [sharing, setSharing] = useState<SavedRoute | null>(null);
  const [menu, setMenu] = useState<SavedRoute | null>(null);
  const [confirming, setConfirming] = useState(false);
  const close = () => { setMenu(null); setConfirming(false); };
  const summary = (r: SavedRoute) => `${km(r.distanceM)} km · ${duration(r.timeS)} · ${r.legs} leg${r.legs > 1 ? "s" : ""}${r.shareToken ? " · shared" : ""}`;
  return (
    <>
      <Page title="Saved routes">
        {error && <div class="banner warn">{error}</div>}
        {routes?.length === 0 && (
          <div class="rc-empty">
            <p class="muted">Routes you save or share show up here.</p>
            <button class="btn tertiary sm" onClick={() => { screen.value = "discover"; }}>Plan a route</button>
          </div>
        )}
        <ul class="rc-list">
          {routes?.map((r) => (
            <li key={r.id}>
              <RouteCard polyline={r.polyline} title={r.name} meta={summary(r)} tierM={r.tierM} onOpen={() => openSaved(r)}
                actions={<>
                  <button class="btn primary sm grow" onClick={() => openSaved(r)}>Ride</button>
                  <button class="icon-btn" aria-label={`Share ${r.name}`} onClick={() => setSharing(r)}><Share size={20} /></button>
                  <button class="icon-btn" aria-label={`More for ${r.name}`} onClick={() => setMenu(r)}><More size={20} /></button>
                </>} />
            </li>
          ))}
        </ul>
      </Page>
      <TabBar />
      {menu && (
        <div class="rc-scrim" onClick={close}>
          <div class="rc-menu" role="dialog" aria-label={menu.name} onClick={(e) => e.stopPropagation()}>
            <h3>{menu.name}</h3>
            {/* Plan.tsx's sendToWatch needs a planned RouteResult, so open the route and point at its To watch button. */}
            <button class="btn secondary sm" onClick={() => { const r = menu; close(); openSaved(r); showToast("Open the route, then tap To watch"); }}><Watch /> Send to watch</button>
            {confirming ? (
              <>
                <p class="muted" style={{ margin: "4px 8px" }}>Delete this route? This can't be undone.</p>
                <button class="btn destructive sm" onClick={async () => {
                  const r = menu; close();
                  await api.deleteRoute(r.id).catch((e) => showToast(e.message));
                  reload();
                }}><Trash /> Yes, delete</button>
                <button class="btn tertiary sm" onClick={() => setConfirming(false)}>Keep it</button>
              </>
            ) : (
              <button class="btn destructive sm" onClick={() => setConfirming(true)}><Trash /> Delete</button>
            )}
            <button class="btn tertiary sm" onClick={close}>Cancel</button>
          </div>
        </div>
      )}
      {sharing && (
        <ShareSheet name={sharing.name} routeId={async () => sharing.id} onClose={() => { setSharing(null); reload(); }}
          summary={summary(sharing)} />
      )}
    </>
  );
}
