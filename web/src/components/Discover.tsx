import { useEffect, useState } from "preact/hooks";
import type { LonLat, RouteResult } from "@kayuh/router";
import { router, type NearbyParking } from "../routerClient.ts";
import {
  cap, conditions, locate, loopKm, mode, myLocation, pickIndex, points, prefs, refreshConditions, routerInfo,
  screen, settings, type Mode,
} from "../state.ts";
import { duration, km, OPERATOR_NAMES, sunset, TIER_COLORS, timeOfDay } from "../util.ts";
import { TabBar, TierBar } from "./common.tsx";
import { Layers, Locate, Search } from "./Icons.tsx";
import { SearchSheet } from "./SearchSheet.tsx";
import type { MapView } from "../map.ts";

const FALLBACK: LonLat = [103.9135, 1.3016]; // East Coast Park, until we know where you are

export function Discover({ map }: { map: MapView | null }) {
  const [searching, setSearching] = useState(false);
  const [legend, setLegend] = useState(true);
  const [parking, setParking] = useState<NearbyParking[]>([]);
  const [suggestions, setSuggestions] = useState<{ km: number; r: RouteResult }[]>([]);
  const here = myLocation.value ?? FALLBACK;

  useEffect(() => { locate(); }, []);
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
    mode.value = m;
    const startPoint = myLocation.value ? { ll: myLocation.value, label: "My location" } : null;
    points.value = m === "loop" ? [startPoint] : [startPoint, null];
    pickIndex.value = m === "freeform" ? (startPoint ? 1 : 0) : null;
    screen.value = "plan";
  };

  const openSearch = () => {
    mode.value = "ab";
    points.value = [myLocation.value ? { ll: myLocation.value, label: "My location" } : null, null];
    setSearching(true);
  };

  const c = conditions.value;
  const sun = sunset(new Date());
  const closest = parking[0];

  return (
    <>
      <div class="top-stack">
        <div class="row">
          <button class="searchbox as-button" onClick={openSearch}>
            <Search /> <span class="placeholder">Where to? Place or postal code</span>
          </button>
          <button class="icon-btn raised profile" aria-label="Settings" onClick={() => (screen.value = "me")}>J</button>
        </div>
        <div class="chips">
          <button class="chip active" onClick={openSearch}>A to B</button>
          <button class="chip" onClick={() => start("loop")}>Loop</button>
          <button class="chip" onClick={() => start("freeform")}>Freeform</button>
        </div>
      </div>

      <div class="map-buttons">
        <button class="icon-btn raised" aria-label="Show or hide the legend" aria-pressed={legend} onClick={() => setLegend(!legend)}><Layers /></button>
        <button class="icon-btn raised locate" aria-label="Show my location" onClick={async () => {
          const ll = await locate();
          if (ll) map?.flyTo(ll, 15);
        }}><Locate /></button>
      </div>

      {legend && (
        <div class="legend" aria-label="Map legend">
          {[["Park connector", TIER_COLORS[0]], ["Cycling path", TIER_COLORS[1]], ["Shared path", TIER_COLORS[2]]].map(([l, c]) => (
            <div key={l}><span class="swatch" style={{ background: c }} />{l}</div>
          ))}
          <div><span class="swatch dotted" />Footpath</div>
          <div><span class="p-badge">P</span>Parking on your route</div>
        </div>
      )}

      <div class="sheet discover-sheet">
        <div class="handle" />
        <div class="row between">
          <div class="stack-2">
            <strong class="lg">{parking.length ? `${parking.length} legal parking spot${parking.length > 1 ? "s" : ""} nearby` : "No legal parking within 400 m"}</strong>
            <span class="muted">
              {closest ? `Closest ${closest.dist} m · ${closest.name}` : routerInfo.value ? "Try another spot on the map" : "Loading Singapore's paths…"}
            </span>
          </div>
          <span class="pill-soft">{OPERATOR_NAMES[settings.value.operator]}</span>
        </div>
        <div class="cond-chips">
          {c?.forecast && <span class={c.forecast.rainLikely ? "cond warn" : "cond"}>{c.forecast.text} · {c.forecast.area}</span>}
          {c?.tempC && <span class="cond">{Math.round(c.tempC.value)}°C{c.heat ? ` · heat ${c.heat.level.toLowerCase()}` : ""}</span>}
          <span class="cond">Sunset {timeOfDay(sun)}</span>
        </div>
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
      </div>
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
