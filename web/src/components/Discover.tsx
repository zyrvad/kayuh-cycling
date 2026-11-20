import { useEffect, useRef, useState } from "preact/hooks";
import type { LonLat, RouteResult } from "@kayuh/router";
import { router, type NearbyParking } from "../routerClient.ts";
import { api, type GroupRideSummary } from "../api.ts";
import {
  cap, conditions, groupCap, locate, loopKm, mapIntent, me, mode, myLocation, openGroupRide, pickIndex, points, prefs, refreshConditions, routerInfo,
  screen, settings, type Mode,
} from "../state.ts";
import { duration, km, OPERATOR_NAMES, sunset, TIER_COLORS, timeOfDay } from "../util.ts";
import { Avatar, Compass, Sheet, TabBar, TierBar } from "./common.tsx";
import { Cloud, CloudRain, Layers, Locate, Search } from "./Icons.tsx";
import { SearchSheet } from "./SearchSheet.tsx";
import type { MapView } from "../map.ts";

const FALLBACK: LonLat = [103.9135, 1.3016]; // East Coast Park, until we know where you are

export function Discover({ map }: { map: MapView | null }) {
  const [searching, setSearching] = useState(false);
  const [legend, setLegend] = useState(true);
  const [parking, setParking] = useState<NearbyParking[]>([]);
  const [suggestions, setSuggestions] = useState<{ km: number; r: RouteResult }[]>([]);
  const [condOpen, setCondOpen] = useState(false);
  const condRef = useRef<HTMLDivElement>(null);
  const [nextRide, setNextRide] = useState<GroupRideSummary | null>(null);
  const here = myLocation.value ?? FALLBACK;

  useEffect(() => { locate(); }, []);
  // Your crew's next group ride, if any: the thing you most likely opened the app for.
  useEffect(() => {
    if (me.value?.signedIn) api.groupRides().then((rs) => setNextRide(rs.find((r) => r.myStatus !== "no") ?? null)).catch(() => {});
  }, [me.value?.signedIn]);
  useEffect(() => {
    refreshConditions(here);
    router.parkingNear(here, 400).then(setParking).catch(() => setParking([]));
  }, [here[0], here[1]]);
  useEffect(() => {
    if (!routerInfo.value) return;
    let live = true;
    Promise.all([10, 20].map((k) => router.loops({ start: here, targetKm: k, prefs: prefs.value, capMinutes: cap.value }, )
      .then((rs) => (rs[0] ? { km: k, r: rs[0] } : null)).catch(() => null)))
      .then((s) => live && setSuggestions(s.filter(Boolean) as { km: number; r: RouteResult }[]));
    return () => { live = false; };
  }, [here[0], here[1], routerInfo.value]);

  const start = (m: Mode) => {
    groupCap.value = null;
    mode.value = m;
    const startPoint = myLocation.value ? { ll: myLocation.value, label: "My location" } : null;
    points.value = m === "loop" ? [startPoint] : [startPoint, null];
    pickIndex.value = m === "freeform" ? (startPoint ? 1 : 0) : null;
    screen.value = "plan";
  };

  const openSearch = () => {
    groupCap.value = null;
    mode.value = "ab";
    points.value = [myLocation.value ? { ll: myLocation.value, label: "My location" } : null, null];
    setSearching(true);
  };

  // Home asks for the search sheet by setting mapIntent; open it once, then clear it.
  const intent = mapIntent.value;
  useEffect(() => {
    if (intent === "search") { openSearch(); mapIntent.value = null; }
  }, [intent]);
  // The conditions popover closes on any tap outside it.
  useEffect(() => {
    if (!condOpen) return;
    const away = (e: PointerEvent) => { if (!condRef.current?.contains(e.target as Node)) setCondOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [condOpen]);

  const c = conditions.value;
  const sun = sunset(new Date());
  const closest = parking[0];
  const heatHigh = !!c?.heat && /high|extreme|moderate/i.test(c.heat.level) && !/low/i.test(c.heat.level);
  const warn = !!c?.forecast?.rainLikely || heatHigh;

  return (
    <>
      <div class="top-stack">
        <div class="row">
          <button class="searchbox as-button" data-tour="map-search" onClick={openSearch}>
            <Search /> <span class="placeholder">Where to? Place or postal code</span>
          </button>
          <button class="icon-btn raised profile" aria-label="Settings and profile" data-tour="profile" onClick={() => (screen.value = "me")}>
            <Avatar name={me.value?.displayName || me.value?.email || "Me"} url={me.value?.avatar} />
          </button>
        </div>
        <div class="chips-row">
        <div class="chips">
          <button class="chip active" onClick={openSearch}>A to B</button>
          <button class="chip" onClick={() => start("loop")}>Loop</button>
          <button class="chip" onClick={() => start("freeform")}>Freeform</button>
        </div>
          <div class="cond-wrap" ref={condRef}>
            <button class={`cond-pill${warn ? " warn" : ""}`} aria-expanded={condOpen} aria-label="Weather and sunset" onClick={() => setCondOpen(!condOpen)}>
              {c?.forecast?.rainLikely ? <CloudRain /> : <Cloud />}
              {c?.tempC && <span>{Math.round(c.tempC.value)}°</span>}
              <span><span class="cond-long">Sunset </span>{timeOfDay(sun)}</span>
            </button>
            {condOpen && (
              <div class="cond-pop" role="dialog" aria-label="Conditions">
                {c?.forecast && <div><strong class={c.forecast.rainLikely ? "warn-text" : ""}>{c.forecast.text}</strong><span class="muted">{c.forecast.area}</span></div>}
                {c?.tempC && <div><strong>{Math.round(c.tempC.value)}°C</strong><span class="muted">Temperature</span></div>}
                {c?.heat && <div><strong class={heatHigh ? "warn-text" : ""}>Heat {c.heat.level.toLowerCase()}</strong><span class="muted">WBGT {Math.round(c.heat.wbgt)}</span></div>}
                <div><strong>Sunset {timeOfDay(sun)}</strong><span class="muted">Today</span></div>
                {!c && <span class="muted">Conditions unavailable</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div class="map-buttons">
        <Compass onClick={() => map?.rotateTo(0)} />
        <button class="icon-btn raised" aria-label="Show or hide the legend" aria-pressed={legend} onClick={() => setLegend(!legend)}><Layers /></button>
        <button class="icon-btn raised locate" aria-label="Show my location" onClick={async () => {
          const ll = await locate();
          if (ll) map?.flyTo(ll, 15);
        }}><Locate /></button>
      </div>

      {legend && (
        <div class="legend" data-tour="map-legend" aria-label="Map legend">
          {[["Park connector", TIER_COLORS[0]], ["Cycling path", TIER_COLORS[1]], ["Shared path", TIER_COLORS[2]]].map(([l, c]) => (
            <div key={l}><span class="swatch" style={{ background: c }} />{l}</div>
          ))}
          <div><span class="swatch dotted" />Footpath</div>
          <div><span class="p-badge">P</span>Parking on your route</div>
        </div>
      )}

      <Sheet class="sheet discover-sheet" peek={100} detents={["collapsed", "half", "full"]} initial="half" summary={
        <div class="row between">
          <div class="stack-2">
            <strong class="lg">{parking.length ? `${parking.length} legal parking spot${parking.length > 1 ? "s" : ""} nearby` : "No legal parking within 400 m"}</strong>
            <span class="muted">
              {closest ? `Closest ${closest.dist} m · ${closest.name}` : routerInfo.value ? "Try another spot on the map" : "Loading Singapore's paths…"}
            </span>
          </div>
          <span class="pill-soft">{OPERATOR_NAMES[settings.value.operator]}</span>
        </div>
      }>
        {nextRide && (
          <button class="next-ride" onClick={() => openGroupRide(nextRide.id)}>
            <span class="eyebrow">Next group ride{nextRide.crewName ? ` · ${nextRide.crewName}` : ""}</span>
            <strong>{nextRide.title}</strong>
            <span class="muted">
              {new Date(nextRide.startsAt).toLocaleString("en-SG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
              {" · "}{nextRide.meet.name} · {nextRide.going} going{nextRide.myStatus ? "" : " · tap to RSVP"}
            </span>
          </button>
        )}
        <div class="stack-8">
          <div class="eyebrow">Suggested from here</div>
          <div class="cards">
            {suggestions.length === 0 && <div class="card skeleton">Finding nice loops…</div>}
            {suggestions.map(({ km: k, r }) => (
              <button key={k} class="card" onClick={() => {
                mode.value = "loop";
                loopKm.value = k;
                points.value = [{ ll: here, label: myLocation.value ? "My location" : "East Coast Park" }];
                screen.value = "plan";
              }}>
                <strong>{k} km loop</strong>
                <span class="muted">{km(r.distanceM)} km · {duration(r.timeS)} · {r.legs.length} leg{r.legs.length > 1 ? "s" : ""}</span>
                <TierBar tierM={r.tierM} height={6} />
              </button>
            ))}
          </div>
        </div>
      </Sheet>
      <TabBar />
      {searching && <SearchSheet index={1} title="Where to?" onClose={() => {
        setSearching(false);
        if (points.value[1] || pickIndex.value === 1) {
          if (!points.value[0] && pickIndex.value === null) pickIndex.value = 0;
          screen.value = "plan";
        }
      }} />}
    </>
  );
}
