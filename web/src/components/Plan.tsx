import { useEffect, useState } from "preact/hooks";
import type { RouteResult } from "@kayuh/router";
import { api, type CrewSummary, type NewRoute } from "../api.ts";
import { router } from "../routerClient.ts";
import {
  addStop, cap, current, groupCap, loopKm, me, mode, movePoint, openCrew, openGroupRide, refreshMe, pickIndex, planError, planning, points, prefs, removePoint, results,
  reverseRoute, routeName, savedRouteId, screen, selected, settings, sharedName, showToast,
} from "../state.ts";
import { duration, encodePolyline, km, OPERATOR_NAMES } from "../util.ts";
import { Sheet, TierBar } from "./common.tsx";
import { Back, Bookmark, Close, Grip, Plus, Share, Swap, Timer, Watch } from "./Icons.tsx";
import { SearchSheet } from "./SearchSheet.tsx";

const PROFILE_LABEL = { nicest: "Nicest", balanced: "Balanced", direct: "Direct" } as const;
const PROFILE_NOTE = {
  nicest: "Stays on park connectors and cycling paths wherever it can, even if that's longer.",
  balanced: "Takes some footpaths and quiet roads when they save real distance.",
  direct: "The shortest legal way: more roads, footpaths and lights.",
} as const;

const pct = (r: RouteResult, ...tiers: number[]) => Math.round((100 * tiers.reduce((a, t) => a + r.tierM[t], 0)) / Math.max(1, r.distanceM));

/** What the selected option is for, and what it trades against the nicest one. */
function explainOption(r: RouteResult, all: RouteResult[]): string {
  const nicest = all.find((x) => x.profile === "nicest");
  if (!nicest || nicest === r) {
    return all.length > 1 ? PROFILE_NOTE.nicest : `${PROFILE_NOTE.nicest} The other options found the same route here.`;
  }
  const dKm = (r.distanceM - nicest.distanceM) / 1000;
  const dMin = Math.round((r.timeS - nicest.timeS) / 60);
  const parts = [
    `${dKm < 0 ? "" : "+"}${dKm.toFixed(1)} km`,
    dMin === 0 ? "same time" : `${dMin < 0 ? "" : "+"}${dMin} min`,
    `PCN and cycling paths ${pct(nicest, 0, 1)}% → ${pct(r, 0, 1)}%`,
  ];
  if (r.tierM[5] > 50) parts.push(`${pct(r, 5)}% on roads`);
  return `${PROFILE_NOTE[r.profile]} Compared with Nicest: ${parts.join(", ")}.`;
}
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

/** Where row `i` should sit while row `from` is being dragged to `to`. */
function shiftFor(i: number, from: number, to: number, rowH: number): number {
  if (i === from) return 0;
  if (from < to && i > from && i <= to) return -rowH;
  if (from > to && i >= to && i < from) return rowH;
  return 0;
}

function PointRows({ onEdit }: { onEdit: (i: number) => void }) {
  const pts = points.value;
  const isLoop = mode.value === "loop";
  const rows = isLoop ? pts.slice(0, 1) : pts;
  const [drag, setDrag] = useState<{ from: number; dy: number; rowH: number } | null>(null);
  const target = drag ? Math.max(0, Math.min(rows.length - 1, drag.from + Math.round(drag.dy / drag.rowH))) : -1;
  const canDrag = !isLoop && rows.length > 1;

  const onDown = (i: number) => (e: PointerEvent) => {
    // Keep our own handle on the element: e.currentTarget is cleared once this handler returns.
    const el = e.currentTarget as HTMLElement;
    const row = el.closest(".point-row") as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const rowH = row.offsetHeight + 2;
    setDrag({ from: i, dy: 0, rowH });
    const move = (ev: PointerEvent) => setDrag({ from: i, dy: ev.clientY - startY, rowH });
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      const to = Math.max(0, Math.min(rows.length - 1, i + Math.round((ev.clientY - startY) / rowH)));
      setDrag(null);
      if (to !== i) movePoint(i, to);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <div class="point-rows">
      {rows.map((p, i) => {
        // Kinds follow the slot, so a stop dragged to the top becomes the start.
        const kind = i === 0 ? "start" : i === rows.length - 1 ? "end" : "via";
        const empty = kind === "start" ? "Choose start" : kind === "end" ? "Choose destination" : "Choose a stop";
        const style = drag
          ? { transform: `translateY(${i === drag.from ? drag.dy : shiftFor(i, drag.from, target, drag.rowH)}px)`, transition: i === drag.from ? "none" : "transform 120ms ease" }
          : undefined;
        return (
          <div key={i} class={drag?.from === i ? "point-row dragging" : "point-row"} style={style}>
            <span class={`dot dot-${kind}`} />
            <button class={p ? "point-label" : "point-label empty"} onClick={() => onEdit(i)}>
              {pickIndex.value === i ? "Tap the map…" : p?.label ?? empty}
            </button>
            {(rows.length > 2 || p) && (
              <button class="mini-btn" aria-label={rows.length > 2 ? `Remove ${p?.label ?? empty}` : `Clear ${p?.label ?? empty}`}
                onClick={() => removePoint(i)}><Close size={16} /></button>
            )}
            {canDrag && (
              <button class="mini-btn grip" aria-label={`Move ${p?.label ?? empty}: drag, or use the arrow keys`}
                onPointerDown={onDown(i)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); movePoint(i, i - 1); }
                  if (e.key === "ArrowDown" && i < rows.length - 1) { e.preventDefault(); movePoint(i, i + 1); }
                }}>
                <Grip />
              </button>
            )}
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
  const [groupForm, setGroupForm] = useState(false);
  const r = current.value;
  const isLoop = mode.value === "loop";
  const capMin = cap.value;
  const op = OPERATOR_NAMES[settings.value.operator];

  return (
    <>
      <div class="plan-head raised-card">
        <button class="icon-btn soft" aria-label="Back" onClick={() => { screen.value = "discover"; pickIndex.value = null; sharedName.value = null; groupCap.value = null; }}><Back /></button>
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

      <Sheet class={r ? "sheet plan-sheet" : "sheet plan-sheet compact"} peek={r ? 300 : 96}>
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
                    <span class="seg-title">{isLoop ? `Loop ${i + 1}` : PROFILE_LABEL[alt.profile]}</span>
                    <span class="seg-sub">{km(alt.distanceM)} km · {duration(alt.timeS)}</span>
                  </button>
                ))}
              </div>
            )}
            {!isLoop && <p class="option-note">{explainOption(r, results.value)}</p>}
            <div class="stats">
              <div><span class="big">{km(r.distanceM)}</span><span class="unit"> km</span></div>
              <div><span class="big">{duration(r.timeS).replace(" min", "")}</span><span class="unit">{r.timeS < 3600 ? " min" : ""}</span></div>
              <div class="muted">{r.signals} traffic light{r.signals === 1 ? "" : "s"}{r.walkS >= 60 ? ` · +${Math.round(r.walkS / 60)} min walk` : ""}</div>
            </div>
            <TierBar tierM={r.tierM} labels />
            {capMin && (
              <div class="banner ok">
                <Timer />
                {r.legs.length === 1
                  ? `One ${op} ride, under your ${capMin} free minutes`
                  : groupCap.value
                    ? `${r.legs.length} legs, each within the group's shortest free ride (${capMin} min)`
                    : `${r.legs.length} legs, each meant to fit your ${capMin}-min free ${op} ride`}
              </div>
            )}
            {r.warnings.map((w) => <div key={w} class="banner warn">{w}</div>)}

            <button class="btn outline crew-cta" onClick={() => setGroupForm(true)}>Ride this with your crew</button>
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
      </Sheet>

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

      {groupForm && r && <GroupRideForm route={r} onClose={() => setGroupForm(false)} />}
      {editing !== null && (
        <SearchSheet index={editing} title={editing === 0 ? "Start" : editing === points.value.length - 1 ? "Destination" : "Stop"}
          onClose={() => setEditing(null)} />
      )}
    </>
  );
}

/** Next Saturday, 7:30 am local time, as a datetime-local value. */
function nextSaturdayMorning(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  d.setHours(7, 30, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function GroupRideForm({ route, onClose }: { route: RouteResult; onClose: () => void }) {
  const [crews, setCrews] = useState<CrewSummary[] | null>(null);
  const [crewId, setCrewId] = useState("");
  const [title, setTitle] = useState(routeName().slice(0, 80));
  const [at, setAt] = useState(nextSaturdayMorning());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const signedIn = me.value?.signedIn;

  useEffect(() => {
    if (!me.value) refreshMe();
    api.crews().then((c) => { setCrews(c); setCrewId(c[0]?.id ?? ""); }).catch((e) => setError(e.message));
  }, []);

  const start = route.legs[0].from;
  return (
    <div class="sheet-full" role="dialog" aria-label="Plan a group ride">
      <div class="search-head">
        <strong class="lg grow" style={{ alignSelf: "center" }}>Ride this with your crew</strong>
        <button class="icon-btn" aria-label="Close" onClick={onClose}><Close /></button>
      </div>
      <form class="form-body" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const { id } = await api.planGroupRide(crewId, {
            title: title.trim(), startsAt: new Date(at).toISOString(), notes: notes.trim() || undefined,
            meet: { lon: start.lon, lat: start.lat, name: start.name || "Start" },
            route: { ...toNewRoute(route), profile: route.profile },
          });
          showToast("Group ride planned");
          onClose();
          openGroupRide(id);
        } catch (err) { setError((err as Error).message); }
      }}>
        {error && <div class="banner warn">{error}</div>}
        {signedIn === false && <div class="banner info">Sign in first: open the Crew tab.</div>}
        {crews?.length === 0 && (
          <div class="banner info">You're not in a crew yet. <button type="button" class="link-btn" onClick={() => { onClose(); openCrewList(); }}>Start one</button></div>
        )}
        {!!crews?.length && (
          <label class="field"><span>Crew</span>
            <select value={crewId} onChange={(e) => setCrewId((e.target as HTMLSelectElement).value)}>
              {crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label class="field"><span>Title</span>
          <input required maxLength={80} value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field"><span>When</span>
          <input type="datetime-local" required value={at} onInput={(e) => setAt((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field"><span>Notes (optional)</span>
          <textarea rows={3} maxLength={500} value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
            placeholder="Breakfast at Changi Village after?" />
        </label>
        <p class="muted small">Meeting point: {start.name || "the route's start"}. Everyone's free-ride limit is checked, and the route is split for the shortest one.</p>
        <button class="btn primary" disabled={!crewId}>Plan group ride</button>
      </form>
    </div>
  );
}

function openCrewList() {
  screen.value = "crew";
}
