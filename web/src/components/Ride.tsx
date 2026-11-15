import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { haversine, type Instruction, type LonLat, type Poi, type RouteResult } from "@kayuh/router";
import { api } from "../api.ts";
import { clearActiveRide, loadActiveRide, saveActiveRide } from "../activeRide.ts";
import type { MapView } from "../map.ts";
import { rideTitle } from "../places.ts";
import { router } from "../routerClient.ts";
import { angleDiff, bearing, blendAngle, requestCompass, watchCompass } from "../heading.ts";
import { buildActiveRide, current, openRide, prefs, refreshPace, results, rideView, screen, selected, settings, showToast } from "../state.ts";
import { analyse, summary, TrackRecorder } from "../track.ts";
import { clock, encodePolyline, km, OPERATOR_NAMES, timeOfDay } from "../util.ts";
import { Compass } from "./common.tsx";
import { Muted, Speaker, Train, Turn } from "./Icons.tsx";

const OFF_ROUTE_M = 40;
/** Re-route automatically once you've been this far off the route... */
const REROUTE_M = 50;
/** ...for this long: long enough to ignore a GPS wobble or a short detour round an obstacle. */
const REROUTE_AFTER_MS = 15_000;
/** Don't re-route again straight after a re-route. */
const REROUTE_COOLDOWN_MS = 20_000;
/** Save the ride in progress this often, so it survives the app being closed. */
const SAVE_EVERY_MS = 15_000;
/** ?sim=8 plays the ride back at 8x speed: handy on a desk with no GPS. */
const SIM = Number(new URLSearchParams(location.search).get("sim") || 0);
/** Below this the bike is "stopped": GPS course is noise, so the compass (which way you face) takes over. */
const MOVING_KMH = 5;

function pointAt(r: RouteResult, m: number): { ll: LonLat; idx: number } {
  let i = r.cumM.findIndex((c) => c >= m);
  if (i <= 0) return { ll: r.coords[Math.max(0, i)], idx: Math.max(0, i) };
  const [a, b] = [r.coords[i - 1], r.coords[i]];
  const f = (m - r.cumM[i - 1]) / Math.max(0.01, r.cumM[i] - r.cumM[i - 1]);
  return { ll: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], idx: i - 1 };
}

/** Which way the route goes from coords[idx]: towards the point about 25 m further on. */
function routeBearing(r: RouteResult, idx: number): number {
  let j = idx + 1;
  while (j < r.coords.length - 1 && r.cumM[j] - r.cumM[idx] < 25) j++;
  return bearing(r.coords[Math.min(idx, r.coords.length - 2)], r.coords[Math.min(j, r.coords.length - 1)]);
}

/** Path type of the route at coords[idx]. */
function tierAt(r: RouteResult, idx: number): number {
  for (const s of r.segments) if (idx >= s.from && idx < s.to) return s.tier;
  return r.segments.at(-1)?.tier ?? -1;
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
  // The ride carries its own copy of the plan (saved to storage), so closing the app or re-routing doesn't lose it.
  const init = useMemo(() => loadActiveRide() ?? { ...buildActiveRide(current.value!), savedAt: Date.now() }, []);
  const [route, setRoute] = useState<RouteResult>(init.route);
  const routeRef = useRef(init.route);
  const capMin = init.capMinutes;
  const capS = (capMin ?? Infinity) * 60;
  const op = OPERATOR_NAMES[settings.value.operator];
  const [legIndex, setLegIndex] = useState(init.legIndex);
  const [legStart, setLegStart] = useState(init.legStart);
  const [legsDone, setLegsDone] = useState(init.legsDone);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [offRoute, setOffRoute] = useState(false);
  const [rerouting, setRerouting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [bailout, setBailout] = useState<{ mrt: Poi; dist: number } | null>(null);
  const announced = useRef(new Set<number>());
  const idxRef = useRef(0);
  const offCount = useRef(0);
  const offSince = useRef<number | null>(null);
  const lastReroute = useRef(0);
  const reroutingRef = useRef(false);
  const lastLL = useRef<LonLat | null>(null);
  const targets = useRef<LonLat[]>(init.targets);
  const recorder = useRef(new TrackRecorder(init.startedAt, init.track));
  // The estimate the ride is measured against (pace learning), from the plan you started with.
  const modelSPerM = useRef(init.route.timeS / Math.max(1, init.route.distanceM));
  // Mirrors of state for callbacks registered once (GPS, timers).
  const legRef = useRef({ legIndex: init.legIndex, legStart: init.legStart, legsDone: init.legsDone });
  legRef.current = { legIndex, legStart, legsDone };
  // Heading-up: the smoothed direction the map faces, plus the latest compass reading.
  const heading = useRef<number | null>(null);
  const compass = useRef<number | null>(null);
  const moving = useRef(false);
  const lastTurn = useRef(0);
  // Live values for the GPS callback, which is registered once.
  const mapRef = useRef(map);
  mapRef.current = map;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const persist = () => saveActiveRide({
    route: routeRef.current, name: init.name, routeId: init.routeId, capMinutes: capMin, startedAt: init.startedAt,
    ...legRef.current, targets: targets.current, track: recorder.current.toJSON(),
  });

  // Keep the screen on while riding, and save the ride regularly and whenever the app goes to the background.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as any).wakeLock?.request("screen").then((l: typeof lock) => (lock = l)).catch(() => {});
    const t = setInterval(() => setNow(Date.now()), 1000);
    const save = setInterval(persist, SAVE_EVERY_MS);
    const onHide = () => { if (document.visibilityState === "hidden") persist(); };
    document.addEventListener("visibilitychange", onHide);
    rideView.value = "heading";
    results.value = [init.route];
    selected.value = 0;
    requestCompass();
    return () => {
      lock?.release().catch(() => {}); clearInterval(t); clearInterval(save);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  // After a reload the map can arrive a moment after the ride screen.
  useEffect(() => {
    map?.setPadding({ top: 140, bottom: 330, left: 0, right: 0 });
    return () => { map?.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); map?.setDone([]); map?.rotateTo(0, 600); };
  }, [map]);

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
    const r = routeRef.current;
    moving.current = kmh === null ? onRoute : kmh >= MOVING_KMH;
    if (moving.current) return onRoute ? routeBearing(r, idxRef.current) : course ?? routeBearing(r, idxRef.current);
    return compass.current ?? heading.current ?? routeBearing(r, idxRef.current);
  };

  /** The stops not reached yet, then the destination. */
  const remainingTargets = (): LonLat[] => {
    const r = routeRef.current;
    const all = targets.current;
    const keep = all.slice(0, -1).filter(([lon, lat]) => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < r.coords.length; i++) {
        const d = haversine(lon, lat, r.coords[i][0], r.coords[i][1]);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best > idxRef.current;
    });
    return [...keep, all[all.length - 1]];
  };

  /** Plan again from where you are without stopping the ride: the leg timer, the track and the stats carry on. */
  const reroute = (here: LonLat, to?: LonLat[], why = "Re-routing") => {
    if (reroutingRef.current) return;
    reroutingRef.current = true;
    lastReroute.current = Date.now();
    setRerouting(true);
    const goal = to ?? remainingTargets();
    const usedS = (Date.now() - legRef.current.legStart) / 1000;
    if (!mutedRef.current) speak(why);
    router.plan({ points: [here, ...goal], prefs: prefs.value, capMinutes: capMin, onBike: { usedS: capMin ? usedS : 0 } })
      .then((routes) => {
        const r = routes.find((x) => x.profile === routeRef.current.profile) ?? routes[0];
        if (!r) throw new Error("no route");
        // The leg you're on carries on as the new route's first leg.
        setLegsDone(legRef.current.legsDone + legRef.current.legIndex);
        legRef.current = { ...legRef.current, legsDone: legRef.current.legsDone + legRef.current.legIndex, legIndex: 0 };
        setLegIndex(0);
        routeRef.current = r;
        setRoute(r);
        results.value = [r];
        selected.value = 0;
        targets.current = goal;
        idxRef.current = 0;
        offCount.current = 0;
        offSince.current = null;
        announced.current.clear();
        setOffRoute(false);
        setProgress(0);
        mapRef.current?.setDone([]);
        persist();
        if (!mutedRef.current) speak(`New route: ${km(r.distanceM)} kilometres${r.legs.length > 1 ? `, ${r.legs.length} rides` : ""}.`);
      })
      .catch(() => showToast("Couldn't find a new route from here. Head back to the line or try again."))
      .finally(() => { reroutingRef.current = false; setRerouting(false); });
  };

  const onPosition = (ll: LonLat, kmh: number | null, course: number | null = null, alt: number | null = null, atMs = Date.now()) => {
    const r = routeRef.current;
    lastLL.current = ll;
    // Search a window ahead of the last match so loops and out-and-backs don't jump around.
    let best = idxRef.current, bestD = Infinity;
    const end = Math.min(r.coords.length - 1, idxRef.current + 400);
    for (let i = Math.max(0, idxRef.current - 10); i <= end; i++) {
      const d = haversine(ll[0], ll[1], r.coords[i][0], r.coords[i][1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (bestD > OFF_ROUTE_M) {
      offCount.current++;
      offSince.current ??= atMs;
    } else {
      offCount.current = 0;
      offSince.current = null;
      idxRef.current = best;
    }
    const onRoute = offCount.current === 0;
    recorder.current.add(ll, atMs, alt, kmh, onRoute ? tierAt(r, idxRef.current) : -1);
    setOffRoute(offCount.current >= 3);
    setProgress(r.cumM[idxRef.current]);
    if (kmh !== null) setSpeed(kmh);
    mapRef.current?.setMe(ll);
    mapRef.current?.setDone(r.coords.slice(0, idxRef.current + 1));
    const target = faceTowards(onRoute, kmh, course);
    if (target !== null) heading.current = heading.current === null ? target : blendAngle(heading.current, target, 0.6);
    const view = rideView.value;
    // Free: keep whatever rotation the rider twisted the map to.
    mapRef.current?.follow(ll, view === "north" ? 0 : view === "heading" && heading.current !== null ? heading.current : undefined);

    // Like a car sat-nav: a sustained detour (your group took another way) gets a new route from here.
    if (offSince.current !== null && offCount.current >= 3 && bestD >= REROUTE_M
      && atMs - offSince.current >= REROUTE_AFTER_MS && Date.now() - lastReroute.current >= REROUTE_COOLDOWN_MS) {
      reroute(ll);
    }
  };

  useEffect(() => {
    if (SIM) {
      let m = 0, simMs = init.startedAt;
      const kmh = settings.value.speedKmh;
      const t = setInterval(() => {
        const r = routeRef.current;
        m = Math.min(r.distanceM, m + (kmh / 3.6) * SIM * 0.5);
        simMs += 500 * SIM;
        onPosition(pointAt(r, m).ll, kmh, null, null, simMs);
      }, 500);
      return () => clearInterval(t);
    }
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => onPosition(
        [p.coords.longitude, p.coords.latitude],
        p.coords.speed != null ? p.coords.speed * 3.6 : null,
        p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
        p.coords.altitude ?? null,
        p.timestamp,
      ),
      () => showToast("Location unavailable: allow location access for ride mode"),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const leg = route.legs[Math.min(legIndex, route.legs.length - 1)];
  const lastLeg = legIndex >= route.legs.length - 1;
  const legEndM = route.cumM[leg.endIndex];
  const toPark = Math.max(0, legEndM - progress);
  const freeLeft = capS - (now - legStart) / 1000;
  const next: Instruction | undefined = route.instructions.find((i) => i.atM > progress + 3);
  const toNext = next ? Math.max(0, next.atM - progress) : 0;
  const atStop = toPark < 30 && progress > 0;
  const remainingS = Math.max(0, route.timeS * (1 - progress / route.distanceM));
  const spareS = freeLeft - (toPark / Math.max(1, settings.value.speedKmh / 3.6));
  const legNo = legsDone + legIndex + 1;
  const legsTotal = legsDone + route.legs.length;

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
    const key = 10000 + legNo;
    if (freeLeft < 300 && freeLeft > 0 && !announced.current.has(key)) {
      announced.current.add(key);
      speak(`Five minutes of free ride left. Parking in ${Math.round(toPark / 100) * 100} metres.`);
    }
  }, [Math.floor(freeLeft / 10), muted]);

  const nextLeg = () => {
    recorder.current.newLeg();
    const t = Date.now();
    setLegIndex(legIndex + 1);
    setLegStart(t);
    legRef.current = { ...legRef.current, legIndex: legIndex + 1, legStart: t };
    persist();
    if (!muted) speak(`Ride ${legNo + 1} started. ${Math.round(route.legs[legIndex + 1].timeS / 60)} minutes to the next parking.`);
  };

  const endRide = async () => {
    const rec = recorder.current;
    const track = rec.toJSON();
    const a = rec.samples.length >= 2 ? analyse(rec.samples, rec.legStarts) : null;
    const startLL = rec.samples[0]?.ll ?? init.route.coords[0];
    const endLL = rec.samples.at(-1)?.ll ?? route.coords[route.coords.length - 1];
    const distanceM = Math.round(SIM ? route.distanceM : a?.distanceM ?? progress);
    // What you actually rode, path type by path type (off-route stretches shared out like the rest).
    let tierM = route.tierM.map(Math.round);
    if (a && !SIM) {
      const known = [0, 0, 0, 0, 0, 0];
      for (let i = 1; i < rec.samples.length; i++) if (rec.samples[i].tier >= 0) known[rec.samples[i].tier] += a.cumM[i] - a.cumM[i - 1];
      const sum = known.reduce((x, y) => x + y, 0);
      if (sum > 0) tierM = known.map((m) => Math.round((m / sum) * distanceM));
    }
    try {
      const name = (await rideTitle(init.name, startLL, endLL)).slice(0, 80);
      const { id } = await api.logRide({
        name, routeId: init.routeId, riddenAt: new Date(init.startedAt).toISOString(),
        distanceM, timeS: Math.round((Date.now() - init.startedAt) / 1000), tierM,
        polyline: encodePolyline(a && !SIM ? rec.samples.filter((_, i) => i % Math.ceil(rec.samples.length / 1500) === 0 || i === rec.samples.length - 1).map((s) => s.ll)
          : route.coords.slice(0, idxRef.current + 1).length > 1 ? route.coords.slice(0, idxRef.current + 1) : route.coords),
        // A GPS-followed ride teaches Kayuh your pace; a simulated one doesn't.
        source: SIM ? "planned" : "recorded",
        predictedS: Math.round((modelSPerM.current * distanceM) / (prefs.value.paceFactor ?? 1)),
        track, stats: a ? summary(a) : null,
      });
      clearActiveRide();
      refreshPace();
      showToast("Ride saved (private)");
      openRide(id);
    } catch (e) {
      clearActiveRide();
      showToast(`Ride ended, but couldn't be saved: ${e instanceof Error ? e.message : "offline?"}`);
      screen.value = "discover";
    }
  };

  const showBailout = async () => {
    allPois ??= await router.pois();
    const here = lastLL.current ?? pointAt(route, progress).ll;
    let best: { mrt: Poi; dist: number } | null = null;
    for (const p of allPois) {
      if (p.k !== "mrt") continue;
      const d = haversine(here[0], here[1], p.lon, p.lat);
      if (!best || d < best.dist) best = { mrt: p, dist: d };
    }
    setBailout(best);
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

      {(offRoute || rerouting) && (
        <div class="banner warn ride-off" role="status">
          {rerouting ? "Finding a new route from here…" : "Off the route: Kayuh re-routes if you keep going"}
          {!rerouting && <button class="link-btn" onClick={() => lastLL.current && reroute(lastLL.current)}>Re-route now</button>}
        </div>
      )}

      <div class="ride-card raised-card">
        {atStop && !lastLeg ? (
          <div class="stack-8">
            <strong class="lg">Park, scan the QR code and end ride {legNo} in {op}</strong>
            <span class="muted">Then unlock again: leg {legNo + 1} is {km(route.legs[legIndex + 1].distanceM)} km, about {Math.round(route.legs[legIndex + 1].timeS / 60)} min.</span>
            <button class="btn primary" onClick={nextLeg}>I've unlocked: start leg {legNo + 1}</button>
          </div>
        ) : (
          <>
            <div class="row between">
              <span class="eyebrow">Leg {legNo} of {legsTotal}{Number.isFinite(capS) ? " · free ride left" : ""}</span>
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
          <span class="muted">{km(bailout.dist)} km away. Kayuh will route you to legal parking near the station, and your ride carries on.</span>
          <div class="row gap-10">
            <button class="btn outline grow" onClick={() => setBailout(null)}>Keep riding</button>
            <button class="btn primary grow" onClick={() => {
              const mrt = bailout.mrt;
              setBailout(null);
              reroute(lastLL.current ?? pointAt(route, progress).ll, [[mrt.lon, mrt.lat]], `Heading to ${mrt.n || "the MRT"}`);
            }}>Go to MRT</button>
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
