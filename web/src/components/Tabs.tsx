import { useEffect, useState } from "preact/hooks";
import { api, type SavedRoute } from "../api.ts";
import {
  loopKm, me, mode, pace, points, refreshMe, routerInfo, savedRouteId, screen, settings, showToast, updateSettings, type Settings,
} from "../state.ts";
import { duration, km, OPERATOR_NAMES } from "../util.ts";
import { Avatar, Page, squarePhoto, TabBar, TierBar } from "./common.tsx";
import { showOnboarding } from "./Onboarding.tsx";
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
          <label class="row between toggle">
            <span class="stack-2">
              <span>Learn my pace from rides</span>
              <span class="muted small">
                {pace.value
                  ? `Your last ${pace.value.rides} GPS rides took ${pace.value.factor.toFixed(2)}× Kayuh's estimate${s.learnPace ? ", so estimates are adjusted." : "."}`
                  : "After two rides followed with GPS, estimates adjust to how fast you really go."}
              </span>
            </span>
            <input type="checkbox" checked={s.learnPace} onChange={(e) => updateSettings({ learnPace: (e.target as HTMLInputElement).checked })} />
          </label>
          <p class="muted small">Estimates include about 40 s at each set of traffic lights and 1.5 min to re-park between legs. They come out around 1.5–2× Google Maps' cycling times.</p>
        </section>
        <section class="group">
          <h2>Route preferences</h2>
          <Slider label="Footpaths" k="footpathAversion" min={0} max={1} step={0.05} format={aversion} />
          <Slider label="Traffic lights and crossings" k="crossingAversion" min={0} max={1} step={0.05} format={aversion} />
          <p class="muted small">Roads are always a last resort. Expressways are never used.</p>
        </section>
        <section class="group">
          <h2>Heart rate &amp; power</h2>
          <BodySettings />
        </section>
        <section class="group">
          <h2>Account</h2>
          <Account />
        </section>
        <section class="group">
          <h2>Intro</h2>
          <button class="btn outline" onClick={() => (showOnboarding.value = true)}>Replay intro</button>
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

/** The five optional numbers behind heart-rate zones, Relative Effort and power metrics. */
function BodySettings() {
  const m = me.value;
  const s = settings.value;
  const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  useEffect(() => { if (!m) refreshMe(); }, []);
  const [v, setV] = useState({ birthYear: "", maxHr: "", restHr: "", ftpW: "", weightKg: "" });
  useEffect(() => {
    if (m) setV({ birthYear: str(m.birthYear), maxHr: str(m.maxHr), restHr: str(m.restHr), ftpW: str(m.ftpW), weightKg: str(m.weightKg) });
  }, [m?.birthYear, m?.maxHr, m?.restHr, m?.ftpW, m?.weightKg]);
  const field = (k: keyof typeof v, label: string, hint: string, min: number, max: number, step = 1) => (
    <label class="field"><span>{label}</span>
      <input type="number" inputMode="decimal" min={min} max={max} step={step} value={v[k]} onInput={(e) => setV({ ...v, [k]: (e.target as HTMLInputElement).value })} />
      <span class="muted small">{hint}</span>
    </label>
  );
  return (
    <form class="stack-8" onSubmit={async (e) => {
      e.preventDefault();
      const n = (x: string) => (x.trim() === "" ? null : Number(x));
      await api.saveMe({
        operator: s.operator, capMinutes: s.capMinutes, speedKmh: s.speedKmh,
        birthYear: n(v.birthYear), maxHr: n(v.maxHr), restHr: n(v.restHr), ftpW: n(v.ftpW), weightKg: n(v.weightKg),
      }).then(refreshMe).then(() => showToast("Saved")).catch((err) => showToast(err.message));
    }}>
      <p class="muted small">Optional. Used for your heart-rate zones, effort and power numbers, which only you can see.</p>
      {field("birthYear", "Birth year", "Used to estimate your max heart rate if you don't enter it", 1920, new Date().getFullYear())}
      {field("maxHr", "Max heart rate (bpm)", "Used for heart-rate zones; leave blank to estimate from your age", 120, 230)}
      {field("restHr", "Resting heart rate (bpm)", "Your heart rate when you wake up, before getting out of bed", 30, 100)}
      {field("ftpW", "FTP (watts)", "The power you could hold for about an hour; sets your power zones and training stress", 50, 600)}
      {field("weightKg", "Weight (kg)", "For watts per kilogram", 30, 200, 0.1)}
      <button class="btn primary">Save</button>
    </form>
  );
}

function Account() {
  const m = me.value;
  const [name, setName] = useState(m?.displayName ?? "");
  useEffect(() => { if (!m) refreshMe(); }, []);
  useEffect(() => setName(m?.displayName ?? ""), [m?.displayName]);
  if (!m?.signedIn) {
    return <p class="muted small">Not signed in: your routes and rides are saved to this device. Signing in keeps them on every device and lets you join crews.</p>;
  }
  const s = settings.value;
  return (
    <>
    <PhotoPicker name={m.displayName || m.email || "Me"} url={m.avatar} />
    <form class="stack-8" onSubmit={async (e) => {
      e.preventDefault();
      await api.saveMe({ operator: s.operator, capMinutes: s.capMinutes, speedKmh: s.speedKmh, displayName: name.trim() })
        .then(refreshMe).then(() => showToast("Saved")).catch((err) => showToast(err.message));
    }}>
      <p class="muted small">Signed in as <strong>{m.email}</strong>. Your routes and rides follow you to any device.</p>
      <label class="field"><span>Name your crews see</span>
        <input required maxLength={40} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <div class="row gap-10">
        <button class="btn primary grow">Save name</button>
        <a class="btn outline grow" href="/cdn-cgi/access/logout">Sign out</a>
      </div>
    </form>
    </>
  );
}

function PhotoPicker({ name, url }: { name: string; url: string | null }) {
  const [busy, setBusy] = useState(false);
  const pick = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true);
    try {
      await api.setAvatar(await squarePhoto(file));
      await refreshMe();
      showToast("Profile picture updated");
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : "Couldn't use that photo");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="photo-picker">
      <Avatar name={name} url={url} class="xl" />
      <div class="stack-8 grow">
        <label class={busy ? "btn outline small-btn disabled" : "btn outline small-btn"}>
          {busy ? "Uploading…" : url ? "Change photo" : "Add a photo"}
          <input type="file" accept="image/*" class="sr" disabled={busy} onChange={pick} />
        </label>
        {url && !busy && (
          <button type="button" class="link-btn" onClick={async () => {
            await api.removeAvatar().then(refreshMe).catch((err) => showToast(err.message));
          }}>Remove photo</button>
        )}
      </div>
    </div>
  );
}
