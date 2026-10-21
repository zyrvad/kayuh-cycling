import { useState } from "preact/hooks";
import type { RouteResult } from "@kayuh/router";
import { api, type NewRoute } from "../api.ts";
import { router } from "../routerClient.ts";
import {
  addStop, cap, current, loopKm, mode, pickIndex, planError, planning, points, prefs, removePoint, results,
  reverseRoute, routeName, savedRouteId, screen, selected, settings, sharedName, showToast,
} from "../state.ts";
import { duration, encodePolyline, km, OPERATOR_NAMES } from "../util.ts";
import { TierBar } from "./common.tsx";
import { Back, Bookmark, Close, Plus, Share, Swap, Timer, Watch } from "./Icons.tsx";
import { SearchSheet } from "./SearchSheet.tsx";

const PROFILE_LABEL = { nicest: "Nicest", balanced: "Balanced", direct: "Direct" } as const;
const AMENITY_LABEL: Record<string, string> = { water: "water", toilet: "toilet", hawker: "hawker centre", mrt: "MRT", bike_shop: "bike shop" };

function toNewRoute(r: RouteResult): NewRoute {
  const pts = points.value.filter(Boolean).map((p) => p!.ll);
  return {
    name: routeName().slice(0, 80),
    mode: mode.value,
    profile: r.profile,
    // A loop is stored with its generated corners so it replays exactly.
    points: mode.value === "loop" ? [pts[0], ...r.vias, pts[0]] : pts,
    prefs: prefs.value,
    distanceM: Math.round(r.distanceM),
    timeS: Math.round(r.timeS),
    tierM: r.tierM.map(Math.round),
    legs: r.legs.length,
    polyline: encodePolyline(r.coords),
  };
}

async function ensureSaved(r: RouteResult): Promise<string> {
  if (savedRouteId.value) return savedRouteId.value;
  const { id } = await api.saveRoute(toNewRoute(r));
  savedRouteId.value = id;
  return id;
}

async function shareRoute(r: RouteResult) {
  try {
    const id = await ensureSaved(r);
    const { token } = await api.shareRoute(id);
    const url = `${location.origin}/r/${token}`;
    const text = `${routeName()}: ${km(r.distanceM)} km, ${Math.round((100 * (r.tierM[0] + r.tierM[1])) / r.distanceM)}% on park connectors and cycling paths`;
    if (navigator.share) await navigator.share({ title: "Kayuh route", text, url }).catch(() => {});
    else {
      await navigator.clipboard?.writeText(url);
      showToast("Share link copied");
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : "Couldn't share this route");
  }
}

async function sendToWatch(r: RouteResult) {
  const name = routeName();
  const gpx = await router.gpx(r, name);
  const file = new File([gpx], `${name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "kayuh-route"}.gpx`, { type: "application/gpx+xml" });
  // On iPhone the share sheet can hand the file straight to Huawei Health or Zepp.
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  showToast("GPX downloaded: import it in Huawei Health (Me › My route) or Zepp");
}

function PointRows({ onEdit }: { onEdit: (i: number) => void }) {
  const pts = points.value;
  const isLoop = mode.value === "loop";
  const rows = isLoop ? pts.slice(0, 1) : pts;
  return (
    <div class="point-rows">
      {rows.map((p, i) => {
        const kind = i === 0 ? "start" : i === rows.length - 1 ? "end" : "via";
        const empty = kind === "start" ? "Choose start" : kind === "end" ? "Choose destination" : "Choose a stop";
        return (
          <div key={i} class="point-row">
            <span class={`dot dot-${kind}`} />
            <button class={p ? "point-label" : "point-label empty"} onClick={() => onEdit(i)}>
              {pickIndex.value === i ? "Tap the map…" : p?.label ?? empty}
            </button>
            {kind === "via" && <button class="mini-btn" aria-label="Remove stop" onClick={() => removePoint(i)}><Close size={16} /></button>}
          </div>
        );
      })}
      {isLoop && (
        <label class="loop-slider">
          <span>Distance <strong>{loopKm.value} km</strong></span>
          <input type="range" min={4} max={60} step={1} value={loopKm.value}
            onChange={(e) => (loopKm.value = Number((e.target as HTMLInputElement).value))} />
        </label>
      )}
    </div>
  );
}

export function Plan() {
  const [editing, setEditing] = useState<number | null>(null);
  const r = current.value;
  const isLoop = mode.value === "loop";
  const capMin = cap.value;
  const op = OPERATOR_NAMES[settings.value.operator];

  return (
    <>
      <div class="plan-head raised-card">
        <button class="icon-btn soft" aria-label="Back" onClick={() => { screen.value = "discover"; pickIndex.value = null; sharedName.value = null; }}><Back /></button>
        <PointRows onEdit={(i) => setEditing(i)} />
        {!isLoop && (
          <div class="head-actions">
            <button class="icon-btn soft" aria-label="Add a stop" onClick={addStop}><Plus /></button>
            <button class="icon-btn soft" aria-label="Reverse route" onClick={reverseRoute}><Swap /></button>
          </div>
        )}
      </div>

      {pickIndex.value !== null && (
        <div class="pick-banner" role="status">
          {pickIndex.value >= points.value.length
            ? "Tap the map to extend the route"
            : `Tap the map to set the ${pickIndex.value === 0 ? "start" : pickIndex.value === points.value.length - 1 ? "destination" : "stop"}`}
          <button class="link-btn" onClick={() => (pickIndex.value = null)}>{pickIndex.value >= points.value.length ? "Done" : "Cancel"}</button>
        </div>
      )}

      <div class={r ? "sheet plan-sheet" : "sheet plan-sheet compact"}>
        <div class="handle" />
        {sharedName.value && <div class="banner info">Shared route: {sharedName.value}</div>}
        {planning.value && !r && <div class="muted center pad">Finding the nicest paths…</div>}
        {planError.value && <div class="banner warn">{planError.value}</div>}
        {!r && !planning.value && !planError.value && (
          <div class="muted center pad">Choose {isLoop ? "where to start" : "a start and a destination"} to see routes.</div>
        )}
        {r && (
          <>
            {results.value.length > 1 && (
              <div class="segmented" role="group" aria-label="Route options">
                {results.value.map((alt, i) => (
                  <button key={i} class={i === selected.value ? "seg active" : "seg"} aria-pressed={i === selected.value}
                    onClick={() => (selected.value = i)}>
                    {isLoop ? `${km(alt.distanceM)} km` : PROFILE_LABEL[alt.profile]}
                  </button>
                ))}
              </div>
            )}
            <div class="stats">
              <div><span class="big">{km(r.distanceM)}</span><span class="unit"> km</span></div>
              <div><span class="big">{duration(r.timeS).replace(" min", "")}</span><span class="unit">{r.timeS < 3600 ? " min" : ""}</span></div>
              <div class="muted">{r.signals} traffic light{r.signals === 1 ? "" : "s"}</div>
            </div>
            <TierBar tierM={r.tierM} labels />
            {capMin && (
              <div class="banner ok">
                <Timer />
                {r.legs.length === 1
                  ? `One ${op} ride, under your ${capMin} free minutes`
                  : `${r.legs.length} legs, each meant to fit your ${capMin}-min free ${op} ride`}
              </div>
            )}
            {r.warnings.map((w) => <div key={w} class="banner warn">{w}</div>)}

            <ol class="legs" aria-label="Legs">
              <li class="leg start-leg">
                <div class="leg-rail"><span class="leg-dot start" /><span class="rail" /></div>
                <div class="leg-body">
                  <div class="leg-title"><span>Start at {r.legs[0].from.name || "your start"}</span></div>
                  <div class="muted">{r.legs[0].from.walkM ? `${r.legs[0].from.walkM} m walk from your point` : "Unlock your bike here"}</div>
                </div>
              </li>
              {r.legs.map((leg, i) => {
                const last = i === r.legs.length - 1;
                const extras = [leg.to.parking?.c ? "sheltered" : "", ...(leg.to.amenities ?? []).map((a) => AMENITY_LABEL[a])].filter(Boolean);
                return (
                  <li key={i} class="leg">
                    <div class="leg-rail"><span class={last ? "leg-num last" : "leg-num"}>{i + 1}</span>{!last && <span class="rail" />}</div>
                    <div class="leg-body">
                      <div class="leg-title"><span>to {leg.to.name || "destination"}</span><span>{Math.round(leg.timeS / 60)} min</span></div>
                      <div class={leg.overCap ? "warn-text" : "muted"}>
                        {km(leg.distanceM)} km{leg.to.parking ? " · park here" : ""}{extras.length ? ` · ${extras.join(" · ")}` : ""}
                        {leg.overCap && capMin ? ` · ${Math.ceil(leg.timeS / 60 - capMin)} min over the free ride` : ""}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      {r && (
        <div class="action-bar">
          <button class="icon-btn outline" aria-label={savedRouteId.value ? "Saved" : "Save route"} aria-pressed={!!savedRouteId.value}
            onClick={() => ensureSaved(r).then(() => showToast("Saved to Routes")).catch((e) => showToast(e.message))}>
            <Bookmark fill={savedRouteId.value ? "currentColor" : "none"} />
          </button>
          <button class="icon-btn outline" aria-label="Share route" onClick={() => shareRoute(r)}><Share /></button>
          <button class="btn outline grow nowrap" onClick={() => sendToWatch(r)}><Watch /> To watch</button>
          <button class="btn primary grow" onClick={() => (screen.value = "ride")}>Start ride</button>
        </div>
      )}

      {editing !== null && (
        <SearchSheet index={editing} title={editing === 0 ? "Start" : editing === points.value.length - 1 ? "Destination" : "Stop"}
          onClose={() => setEditing(null)} />
      )}
    </>
  );
}
