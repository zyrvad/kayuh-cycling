import { useEffect, useRef, useState } from "preact/hooks";
import type { LonLat } from "@kayuh/router";
import { api } from "../api.ts";
import {
  addFix, clearFreeRide, freeSecondsLeft, isWarn, loadFreeRide, movingSeconds, newFreeRide, pause, resume, rideName,
  saveFreeRide, tooShort, type FreeRideState,
} from "../freeRide.ts";
import type { MapView } from "../map.ts";
import { router, type NearbyParking } from "../routerClient.ts";
import { cap, openRide, refreshPace, rideDetail, screen, showToast } from "../state.ts";
import { analyse, summary, TrackRecorder } from "../track.ts";
import { clock, encodePolyline, km } from "../util.ts";
import { Pause, Play } from "./Icons.tsx";
import "./freeride.css";

const SAVE_EVERY_MS = 10_000;
type Mode = "idle" | "riding" | "confirm" | "discard" | "saving";

export function FreeRide({ map }: { map: MapView | null }) {
  const [resumed] = useState(() => loadFreeRide());
  const st = useRef<FreeRideState | null>(resumed);
  const rec = useRef<TrackRecorder | null>(null);
  if (rec.current === null && resumed && st.current === resumed) rec.current = new TrackRecorder(resumed.startedAt, resumed.track);
  const saving = useRef(false);
  const mapRef = useRef(map);
  mapRef.current = map;
  const [mode, setMode] = useState<Mode>(resumed ? "riding" : "idle");
  const [now, setNow] = useState(Date.now());
  const [kmh, setKmh] = useState(0);
  const [parking, setParking] = useState<NearbyParking | null | "none">(null);
  const [short, setShort] = useState(false);
  const lastFix = useRef<{ ll: LonLat; t: number } | null>(null);
  const here = useRef<LonLat | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [, bump] = useState(0);

  const persist = () => {
    const s = st.current, r = rec.current;
    if (s && r) saveFreeRide({ ...s, track: r.toJSON() });
  };

  // Map: nothing planned here; clear any leftover line and show the ridden line as it grows.
  useEffect(() => {
    map?.setDone([]);
    map?.setPoints([]);
    return () => { map?.setDone([]); map?.setMe(null); };
  }, [map]);

  // Location: always watch (shows you on the map before Start), record only while riding.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const save = setInterval(() => { if (modeRef.current === "riding") persist(); }, SAVE_EVERY_MS);
    const onVis = () => { if (document.visibilityState === "hidden") persist(); };
    document.addEventListener("visibilitychange", onVis);
    let id: number | null = null;
    if ("geolocation" in navigator) {
      id = navigator.geolocation.watchPosition(
        (p) => {
          const ll: LonLat = [p.coords.longitude, p.coords.latitude];
          const at = p.timestamp || Date.now();
          here.current = ll;
          mapRef.current?.setMe(ll);
          const s = st.current;
          if (!s || s.pausedAt !== null || modeRef.current === "idle") { mapRef.current?.follow(ll); return; }
          const f = addFix(s.distanceM, s.last, ll, p.coords.accuracy ?? null);
          if (f.counted) {
            let v: number | null = p.coords.speed != null && Number.isFinite(p.coords.speed) && p.coords.speed >= 0 ? p.coords.speed * 3.6 : null;
            const prev = lastFix.current;
            if (v === null && prev && at > prev.t) v = (f.distanceM - s.distanceM) / ((at - prev.t) / 1000) * 3.6;
            setKmh(v ?? 0);
            lastFix.current = { ll, t: at };
            st.current = { ...s, distanceM: f.distanceM, last: f.last };
            rec.current?.add(ll, at, p.coords.altitude ?? null, v, -1);
            mapRef.current?.setDone(rec.current?.samples.map((x) => x.ll) ?? []);
          } else if (f.last && s.distanceM > 0 && at - (lastFix.current?.t ?? 0) > 4000) setKmh(0);
          mapRef.current?.follow(ll);
        },
        () => showToast("Location unavailable: allow location access for free ride"),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
      );
    }
    return () => {
      if (id !== null) navigator.geolocation.clearWatch(id);
      clearInterval(tick); clearInterval(save);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Keep the screen on while riding.
  useEffect(() => {
    if (mode !== "riding" && mode !== "confirm") return;
    let lock: { release: () => Promise<void> } | null = null, gone = false;
    const acquire = () => {
      if (gone || lock) return;
      (navigator as any).wakeLock?.request("screen").then((l: NonNullable<typeof lock> & { addEventListener?: (t: string, f: () => void) => void }) => {
        if (gone) { l?.release().catch(() => {}); return; }
        lock = l;
        l?.addEventListener?.("release", () => { if (lock === l) lock = null; });
      }).catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === "visible") acquire(); };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => { gone = true; document.removeEventListener("visibilitychange", onVisible); lock?.release().catch(() => {}); };
  }, [mode === "riding" || mode === "confirm"]);

  const start = () => {
    const t = Date.now();
    st.current = newFreeRide(t, cap.value);
    rec.current = new TrackRecorder(t);
    lastFix.current = null;
    setShort(false);
    persist();
    setMode("riding");
    if (here.current) rec.current.add(here.current, t, null, null, -1);
    if (here.current) st.current = { ...st.current, last: here.current };
  };

  const leave = () => { clearFreeRide(); st.current = null; rec.current = null; screen.value = "home"; };

  const togglePause = () => {
    const s = st.current; if (!s) return;
    const t = Date.now();
    // On resume the first new fix starts a fresh step: the gap isn't ridden distance.
    st.current = s.pausedAt === null ? pause(s, t) : { ...resume(s, t), last: null };
    persist();
    bump((n) => n + 1);
  };

  const nearest = async () => {
    if (!here.current) { showToast("Waiting for your location"); return; }
    try {
      const list = await router.parkingNear(here.current, 600);
      setParking(list[0] ?? "none");
    } catch { setParking("none"); }
  };

  const save = async () => {
    const s = st.current, r = rec.current;
    if (!s || !r || saving.current) return;
    const t = Date.now();
    const a = r.samples.length >= 2 ? analyse(r.samples, r.legStarts) : null;
    const distanceM = Math.round(a?.distanceM ?? s.distanceM);
    if (!a || tooShort(distanceM)) { setShort(true); setMode("riding"); return; }
    saving.current = true;
    setMode("saving");
    try {
      // Path types for the line you rode: classify each (thinned) point, share each step's distance out by tier.
      const stride = Math.max(1, Math.ceil(r.samples.length / 1500));
      const idx = r.samples.map((_, i) => i).filter((i) => i % stride === 0 || i === r.samples.length - 1);
      const tiers = await router.classify(idx.map((i) => r.samples[i].ll)).catch(() => [] as number[]);
      const tierOf = new Array<number>(r.samples.length).fill(-1);
      idx.forEach((i, k) => { const x = tiers[k]; if (typeof x === "number" && x >= 0 && x <= 5) tierOf[i] = x; });
      let last = -1;
      r.samples.forEach((smp, i) => { if (tierOf[i] >= 0) last = tierOf[i]; smp.tier = last; });
      const b = analyse(r.samples, r.legStarts);
      const known = [0, 0, 0, 0, 0, 0];
      for (let i = 1; i < r.samples.length; i++) if (r.samples[i].tier >= 0) known[r.samples[i].tier] += b.cumM[i] - b.cumM[i - 1];
      const sum = known.reduce((x, y) => x + y, 0);
      const tierM = sum > 0 ? known.map((m) => Math.round((m / sum) * distanceM)) : [0, 0, 0, 0, 0, 0];
      const poly = r.samples.filter((_, i) => i % stride === 0 || i === r.samples.length - 1).map((x) => x.ll);
      const { id } = await api.logRide({
        name: rideName(new Date(s.startedAt)), routeId: null, riddenAt: new Date(s.startedAt).toISOString(),
        distanceM, timeS: Math.round(movingSeconds(s, t)), tierM, polyline: encodePolyline(poly), source: "recorded",
        predictedS: null, track: r.toJSON(), stats: summary(b),
      });
      clearFreeRide();
      st.current = null; rec.current = null;
      refreshPace();
      showToast("Ride saved (private)");
      openRide(id);
      if (rideDetail.value) rideDetail.value = { ...rideDetail.value, back: "home" };
    } catch (e) {
      showToast(`Couldn't save: ${e instanceof Error ? e.message : "offline?"}. Your ride is kept: try Finish again.`);
      setMode("confirm");
    } finally {
      saving.current = false;
    }
  };

  const s = st.current;
  const riddenS = s ? movingSeconds(s, now) : 0;
  const left = s ? freeSecondsLeft(s.capMinutes, riddenS) : null;
  const paused = !!s && s.pausedAt !== null;

  return (
    <>
      <div class="ride-card raised-card fr-card">
        {mode === "idle" && (
          <>
            <div class="fr-title">Free ride</div>
            <div class="fr-sub">Records your ride. No route, no stops.</div>
            <button class="btn primary tall" onClick={start}>Start</button>
            <button class="btn tertiary" onClick={leave}>Cancel</button>
          </>
        )}
        {(mode === "riding" || mode === "saving") && s && (
          <>
            <div class="fr-main">
              <div class="timer" aria-label="Elapsed time">{clock(riddenS)}</div>
              {paused && <span class="fr-paused">Paused</span>}
            </div>
            <div class="ride-stats">
              <div><span>{km(s.distanceM)}</span><small>km</small></div>
              <div><span>{paused ? "0" : Math.round(kmh)}</span><small>km/h</small></div>
            </div>
            {left !== null && (
              <div class={`fr-free${isWarn(left) ? " warn" : ""}`}>
                <span>Free minutes left</span><b>{clock(Math.max(left, left < 0 ? left : 0))}</b>
              </div>
            )}
            {parking && (
              <div class="fr-park">
                {parking === "none" ? "No legal parking within 600 m" : `${parking.name || "Bike parking"}, ${Math.round(parking.dist)} m away`}
              </div>
            )}
            {short && <div class="fr-notice">Too short to save (under 100 m). Keep riding, or discard.</div>}
            {left !== null && <button class="btn secondary sm" onClick={nearest}>Nearest parking</button>}
            <div class="fr-row">
              <button class="btn secondary" onClick={togglePause}>{paused ? <><Play />Resume</> : <><Pause />Pause</>}</button>
              <button class="btn primary" disabled={mode === "saving"} onClick={() => setMode("confirm")}>{mode === "saving" ? "Saving…" : "Finish"}</button>
            </div>
          </>
        )}
        {mode === "confirm" && (
          <div class="fr-confirm">
            <strong>Finish and save this ride?</strong>
            <div class="fr-row">
              <button class="btn primary" disabled={mode !== "confirm"} onClick={save}>Save</button>
              <button class="btn secondary" onClick={() => setMode("riding")}>Keep riding</button>
            </div>
            <button class="btn destructive" onClick={() => setMode("discard")}>Discard ride</button>
          </div>
        )}
        {mode === "discard" && (
          <div class="fr-confirm">
            <strong>Discard this ride? It can't be recovered.</strong>
            <div class="fr-row">
              <button class="btn destructive" onClick={leave}>Discard</button>
              <button class="btn secondary" onClick={() => setMode("confirm")}>Back</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
