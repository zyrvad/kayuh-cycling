import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { haversine, type Instruction, type LonLat, type Poi, type RouteResult } from "@kayuh/router";
import { api } from "../api.ts";
import type { MapView } from "../map.ts";
import { router } from "../routerClient.ts";
import { angleDiff, bearing, blendAngle, requestCompass, watchCompass } from "../heading.ts";
import { cap, current, mode, points, prefs, refreshPace, rideView, routeName, savedRouteId, screen, settings, showToast } from "../state.ts";
import { clock, encodePolyline, km, OPERATOR_NAMES, timeOfDay } from "../util.ts";
import { Compass } from "./common.tsx";
import { Muted, Speaker, Train, Turn } from "./Icons.tsx";

const OFF_ROUTE_M = 40;
/** Below this the bike is "stopped": GPS course is noise, so the compass (which way you face) takes over. */
const MOVING_KMH = 5;

/** Which way the route goes from coords[idx]: towards the point about 25 m further on. */
function routeBearing(r: RouteResult, idx: number): number {
  let j = idx + 1;
  while (j < r.coords.length - 1 && r.cumM[j] - r.cumM[idx] < 25) j++;
  return bearing(r.coords[Math.min(idx, r.coords.length - 2)], r.coords[Math.min(j, r.coords.length - 1)]);
}
/** ?sim=8 plays the ride back at 8x speed: handy on a desk with no GPS. */
const SIM = Number(new URLSearchParams(location.search).get("sim") || 0);

function pointAt(r: RouteResult, m: number): { ll: LonLat; idx: number } {
  let i = r.cumM.findIndex((c) => c >= m);
  if (i <= 0) return { ll: r.coords[Math.max(0, i)], idx: Math.max(0, i) };
  const [a, b] = [r.coords[i - 1], r.coords[i]];
  const f = (m - r.cumM[i - 1]) / Math.max(0.01, r.cumM[i] - r.cumM[i - 1]);
  return { ll: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], idx: i - 1 };
}

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-SG";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

let allPois: Poi[] | null = null;

export function Ride({ map }: { map: MapView | null }) {
  // Freeze the route for the whole ride, even if the plan screen changes underneath.
  const route = useMemo(() => current.value!, []);
  const capS = (cap.value ?? Infinity) * 60;
  const op = OPERATOR_NAMES[settings.value.operator];
  const [legIndex, setLegIndex] = useState(0);
  const [legStart, setLegStart] = useState(Date.now());
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [offRoute, setOffRoute] = useState(false);
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [bailout, setBailout] = useState<{ mrt: Poi; dist: number } | null>(null);
  const announced = useRef(new Set<number>());
  const idxRef = useRef(0);
  const offCount = useRef(0);
  const startedAt = useRef(new Date());
  // Heading-up: the smoothed direction the map faces, plus the latest compass reading.
  const heading = useRef<number | null>(null);
  const compass = useRef<number | null>(null);
  const moving = useRef(false);
  const lastTurn = useRef(0);

  // Keep the screen on while riding.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as any).wakeLock?.request("screen").then((l: typeof lock) => (lock = l)).catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    map?.setPadding({ top: 140, bottom: 330, left: 0, right: 0 });
    rideView.value = "heading";
    return () => {
      lock?.release().catch(() => {}); clearInterval(t);
      map?.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); map?.setDone([]); map?.rotateTo(0, 600);
    };
  }, []);

  // While stopped, turn the map with the phone (which way you're facing). Moving, GPS does it in onPosition.
  useEffect(() => watchCompass((deg) => {
    compass.current = deg;
    if (moving.current || rideView.value !== "heading" || !map) return;
    heading.current = heading.current === null ? deg : blendAngle(heading.current, deg, 0.3);
    const t = Date.now();
    if (t - lastTurn.current > 250 && Math.abs(angleDiff(map.map.getBearing(), heading.current)) > 4) {
      lastTurn.current = t;
      map.rotateTo(heading.current, 250);
    }
  }), [map]);

  /** Where the map should face for this fix: the route ahead, your GPS course, or your compass. */
  const faceTowards = (onRoute: boolean, kmh: number | null, course: number | null): number | null => {
    moving.current = kmh === null ? onRoute : kmh >= MOVING_KMH;
    if (moving.current) return onRoute ? routeBearing(route, idxRef.current) : course ?? routeBearing(route, idxRef.current);
    return compass.current ?? heading.current ?? routeBearing(route, idxRef.current);
  };

  const onPosition = (ll: LonLat, kmh: number | null, course: number | null = null) => {
    // Search a window ahead of the last match so loops and out-and-backs don't jump around.
    let best = idxRef.current, bestD = Infinity;
    const end = Math.min(route.coords.length - 1, idxRef.current + 400);
    for (let i = Math.max(0, idxRef.current - 10); i <= end; i++) {
      const d = haversine(ll[0], ll[1], route.coords[i][0], route.coords[i][1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (bestD > OFF_ROUTE_M) offCount.current++;
    else { offCount.current = 0; idxRef.current = best; }
    setOffRoute(offCount.current >= 3);
    setProgress(route.cumM[idxRef.current]);
    if (kmh !== null) setSpeed(kmh);
    map?.setMe(ll);
    map?.setDone(route.coords.slice(0, idxRef.current + 1));
    const target = faceTowards(offCount.current === 0, kmh, course);
    if (target !== null) heading.current = heading.current === null ? target : blendAngle(heading.current, target, 0.6);
    const view = rideView.value;
    // Free: keep whatever rotation the rider twisted the map to.
    map?.follow(ll, view === "north" ? 0 : view === "heading" && heading.current !== null ? heading.current : undefined);
  };

  useEffect(() => {
    if (SIM) {
      let m = 0;
      const kmh = settings.value.speedKmh;
      const t = setInterval(() => {
        m = Math.min(route.distanceM, m + (kmh / 3.6) * SIM * 0.5);
        onPosition(pointAt(route, m).ll, kmh);
      }, 500);
      return () => clearInterval(t);
    }
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => onPosition(
        [p.coords.longitude, p.coords.latitude],
        p.coords.speed != null ? p.coords.speed * 3.6 : null,
        p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
      ),
      () => showToast("Location unavailable: allow location access for ride mode"),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const leg = route.legs[legIndex];
  const lastLeg = legIndex === route.legs.length - 1;
  const legEndM = route.cumM[leg.endIndex];
  const toPark = Math.max(0, legEndM - progress);
  const freeLeft = capS - (now - legStart) / 1000;
  const next: Instruction | undefined = route.instructions.find((i) => i.atM > progress + 3);
  const toNext = next ? Math.max(0, next.atM - progress) : 0;
  const atStop = toPark < 30 && progress > 0;
  const remainingS = Math.max(0, route.timeS * (1 - progress / route.distanceM));
  const spareS = freeLeft - (toPark / Math.max(1, settings.value.speedKmh / 3.6));

  useEffect(() => {
    if (muted || !next) return;
    const key = route.instructions.indexOf(next);
    if (toNext < 120 && !announced.current.has(key)) {
      announced.current.add(key);
      speak(`In ${Math.round(toNext / 10) * 10} metres, ${next.text}`);
    }
  }, [toNext, muted]);

  useEffect(() => {
    if (muted || !Number.isFinite(capS)) return;
    const key = 10000 + legIndex;
    if (freeLeft < 300 && freeLeft > 0 && !announced.current.has(key)) {
      announced.current.add(key);
      speak(`Five minutes of free ride left. Parking in ${Math.round(toPark / 100) * 100} metres.`);
    }
  }, [Math.floor(freeLeft / 10), muted]);

  const nextLeg = () => {
    setLegIndex(legIndex + 1);
    setLegStart(Date.now());
    if (!muted) speak(`Ride ${legIndex + 2} started. ${Math.round(route.legs[legIndex + 1].timeS / 60)} minutes to the next parking.`);
  };

  const endRide = async () => {
    try {
      await api.logRide({
        name: routeName().slice(0, 80), routeId: savedRouteId.value, riddenAt: startedAt.current.toISOString(),
        distanceM: Math.round(Math.max(progress, SIM ? route.distanceM : progress)), timeS: Math.round((Date.now() - startedAt.current.getTime()) / 1000),
        tierM: route.tierM.map(Math.round), polyline: encodePolyline(route.coords.slice(0, idxRef.current + 1).length > 1 ? route.coords.slice(0, idxRef.current + 1) : route.coords),
        // A GPS-followed ride teaches Kayuh your pace; a simulated one doesn't.
        source: SIM ? "planned" : "recorded",
        predictedS: Math.round((route.timeS / (prefs.value.paceFactor ?? 1)) * Math.min(1, progress / route.distanceM)),
      });
      refreshPace();
      showToast("Ride saved to your history (private)");
    } catch (e) {
      showToast(`Ride ended, but couldn't be saved: ${e instanceof Error ? e.message : "offline?"}`);
    }
    screen.value = "discover";
  };

  const showBailout = async () => {
    allPois ??= await router.pois();
    const here = pointAt(route, progress).ll;
    let best: { mrt: Poi; dist: number } | null = null;
    for (const p of allPois) {
      if (p.k !== "mrt") continue;
      const d = haversine(here[0], here[1], p.lon, p.lat);
      if (!best || d < best.dist) best = { mrt: p, dist: d };
    }
    setBailout(best);
  };

  const rerouteFromHere = (to: LonLat, label: string) => {
    const here = pointAt(route, progress).ll;
    mode.value = "ab";
    points.value = [{ ll: here, label: "Here" }, { ll: to, label }];
    screen.value = "plan";
  };

  return (
    <>
      <div class="ride-instruction">
        <Turn type={atStop ? (lastLeg ? "arrive" : "park") : next?.type ?? "continue"} />
        <div class="stack-2">
          <div class="ride-dist">{atStop ? "Here" : toNext >= 1000 ? `${km(toNext)} km` : `${Math.round(toNext / 10) * 10} m`}</div>
          <div class="ride-text">{atStop ? (lastLeg ? "You've arrived: park and end your ride" : `Park at ${leg.to.name}`) : next?.text ?? "Follow the route"}</div>
        </div>
      </div>

      <Compass always class="ride-compass" pressed={rideView.value === "heading"}
        label={rideView.value === "heading" ? "Map turns with you: tap for north up" : "Tap to turn the map with you"}
        onClick={() => {
          requestCompass();
          rideView.value = rideView.value === "heading" ? "north" : "heading";
          const b = rideView.value === "north" ? 0 : heading.current;
          if (b !== null) map?.rotateTo(b, 400);
        }} />
      <button class="icon-btn raised ride-mute" aria-label={muted ? "Unmute voice" : "Mute voice"} onClick={() => setMuted(!muted)}>
        {muted ? <Muted /> : <Speaker />}
      </button>

      {offRoute && (
        <div class="banner warn ride-off">
          You're off the route.
          <button class="link-btn" onClick={() => rerouteFromHere(route.coords[route.coords.length - 1], route.legs.at(-1)!.to.name || "Destination")}>Re-route</button>
        </div>
      )}

      <div class="ride-card raised-card">
        {atStop && !lastLeg ? (
          <div class="stack-8">
            <strong class="lg">Park, scan the QR code and end ride {legIndex + 1} in {op}</strong>
            <span class="muted">Then unlock again: leg {legIndex + 2} is {km(route.legs[legIndex + 1].distanceM)} km, about {Math.round(route.legs[legIndex + 1].timeS / 60)} min.</span>
            <button class="btn primary" onClick={nextLeg}>I've unlocked: start leg {legIndex + 2}</button>
          </div>
        ) : (
          <>
            <div class="row between">
              <span class="eyebrow">Leg {legIndex + 1} of {route.legs.length}{Number.isFinite(capS) ? " · free ride left" : ""}</span>
              <span class="pill-soft">{op}</span>
            </div>
            {Number.isFinite(capS) ? (
              <>
                <div class="row baseline gap-10">
                  <span class={freeLeft < 300 ? "timer warn-text" : "timer"}>{clock(freeLeft)}</span>
                  <span class="muted">of {clock(capS)}</span>
                </div>
                <div class="progress"><div style={{ width: `${Math.max(0, Math.min(100, (100 * freeLeft) / capS))}%` }} /></div>
              </>
            ) : <div class="timer">{clock((now - legStart) / 1000)}</div>}
            <div class="row gap-10 park-line">
              <span class="p-badge lg">P</span>
              <span>{lastLeg ? "Finish" : "Park"} in {km(toPark)} km{Number.isFinite(capS) ? ` · ${spareS >= 0 ? `about ${Math.round(spareS / 60)} min to spare` : `${Math.ceil(-spareS / 60)} min over`}` : ""}</span>
            </div>
          </>
        )}
        <div class="ride-stats">
          <div><span>{speed ? speed.toFixed(1) : "–"}</span><small>km/h</small></div>
          <div><span>{km(Math.max(0, route.distanceM - progress))}</span><small>km to go</small></div>
          <div><span>{timeOfDay(new Date(now + remainingS * 1000))}</span><small>arrive</small></div>
        </div>
      </div>

      {bailout && (
        <div class="bailout raised-card" role="dialog" aria-label="Bail out to MRT">
          <strong class="lg">{bailout.mrt.n || "MRT station"}</strong>
          <span class="muted">{km(bailout.dist)} km away. Kayuh will route you to legal parking near the station.</span>
          <div class="row gap-10">
            <button class="btn outline grow" onClick={() => setBailout(null)}>Keep riding</button>
            <button class="btn primary grow" onClick={() => rerouteFromHere([bailout.mrt.lon, bailout.mrt.lat], bailout.mrt.n || "MRT")}>Go to MRT</button>
          </div>
        </div>
      )}

      <div class="ride-actions">
        <button class="btn raised grow tall" onClick={showBailout}><Train /> Bail out · MRT</button>
        <button class="btn dark grow tall" onClick={() => { if (confirm("End this ride? It will be saved to your private ride history.")) endRide(); }}>End ride</button>
      </div>
    </>
  );
}
