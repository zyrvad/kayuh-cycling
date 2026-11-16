/**
 * Flyover: a 3D aerial replay along a ride or a planned route. The map stays the shared MapView; this draws the
 * controls over it, drives the camera each animation frame, and puts the map back when it closes.
 */
import { haversine, type LonLat } from "@kayuh/router";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { blendAngle, bearing } from "../heading.ts";
import type { MapView } from "../map.ts";
import { clock, km } from "../util.ts";
import { Close } from "./Icons.tsx";
import "./flyover.css";

export interface FlyoverProps {
  map: MapView;
  coords: LonLat[];
  /** Seconds since the start for each coord (a recorded ride). Omit for a planned route. */
  times?: number[];
  /** One colour per coord (e.g. by speed). Omit for the accent green. */
  colors?: string[];
  title: string;
  onClose: () => void;
}

const ACCENT = "#17804F";
const PITCH = 60;
const ZOOM = 16.5;
/** The camera faces the line this far ahead of the head. */
const LOOKAHEAD_M = 80;
/** At 1x a whole ride takes about this long, however long it is... */
const TARGET_SECONDS = 52;
/** ...but a short ride never flies faster than this, so it doesn't blur past. */
const MAX_MPS = 30;
/** Bearing smoothing time constant, ms: bigger is calmer. */
const TURN_MS = 450;
/** Trail redraw interval, ms: rebuilding the GeoJSON every frame is wasteful on long rides. */
const TRAIL_MS = 90;
const SPEEDS = [1, 2, 4];

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Flyover({ map, coords, times, colors, title, onClose }: FlyoverProps) {
  // Cumulative distance along the line, metres.
  const cum = useMemo(() => {
    const c = [0];
    for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
    return c;
  }, [coords]);
  const total = cum[cum.length - 1] || 0;
  const calm = useMemo(reducedMotion, []);

  const [playing, setPlaying] = useState(!calm);
  const [speed, setSpeed] = useState(1);
  const [dist, setDist] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  // Mutable animation state: read by the frame loop without re-rendering.
  const s = useRef({ dist: 0, bearing: 0, playing: !calm, speed: 1, scrubbing: false, lastTrail: 0, lastUi: 0, ready: false });
  s.current.playing = playing;
  s.current.speed = speed;
  s.current.scrubbing = scrubbing;

  /** Index of the last vertex at or before distance d. */
  const indexAt = (d: number) => {
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= d) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const pointAt = (d: number): LonLat => {
    const i = indexAt(d);
    if (i >= coords.length - 1) return coords[coords.length - 1];
    const seg = cum[i + 1] - cum[i];
    const f = seg > 0 ? (d - cum[i]) / seg : 0;
    return [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * f, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * f];
  };
  /** Ride time at distance d, interpolated; stops add no distance so they are skipped. */
  const timeAt = (d: number) => {
    if (!times) return null;
    const i = indexAt(d);
    if (i >= times.length - 1) return times[times.length - 1] ?? 0;
    const seg = cum[i + 1] - cum[i];
    return times[i] + (times[i + 1] - times[i]) * (seg > 0 ? (d - cum[i]) / seg : 0);
  };

  /** Move the camera and redraw the trail for the current distance. */
  const render = (now: number, dt: number, force = false) => {
    const st = s.current;
    const here = pointAt(st.dist);
    const there = pointAt(Math.min(total, st.dist + LOOKAHEAD_M));
    if (haversine(here[0], here[1], there[0], there[1]) > 3) {
      const target = bearing(here, there);
      st.bearing = st.ready ? blendAngle(st.bearing, target, 1 - Math.exp(-dt / TURN_MS)) : target;
    }
    st.ready = true;
    map.cameraJump(here, ZOOM, st.bearing, PITCH);
    if (force || now - st.lastTrail >= TRAIL_MS) {
      st.lastTrail = now;
      const i = indexAt(st.dist);
      const done: { coords: LonLat[]; color: string }[] = [];
      let run: LonLat[] = [coords[0]];
      let runColor = colors?.[0] ?? ACCENT;
      for (let k = 1; k <= i; k++) {
        const c = colors?.[k] ?? ACCENT;
        if (c !== runColor) { done.push({ coords: run, color: runColor }); run = [coords[k - 1]]; runColor = c; }
        run.push(coords[k]);
      }
      run.push(here);
      done.push({ coords: run, color: runColor });
      map.setFlyoverTrail(done, [here, ...coords.slice(i + 1)], here);
    }
    if (force || now - st.lastUi >= 100) { st.lastUi = now; setDist(st.dist); }
  };

  // Enter the flyover on mount, leave (and restore the camera) on unmount.
  useEffect(() => {
    if (coords.length < 2) return;
    let cancelled = false;
    map.setFlyover(true).then(() => { if (!cancelled) render(performance.now(), 0, true); });
    return () => { cancelled = true; void map.setFlyover(false); };
  }, [map, coords]);

  // The frame loop runs only while playing, so a paused map is free to pan and rotate.
  useEffect(() => {
    if (!playing || coords.length < 2) return;
    const mps = Math.min(total / TARGET_SECONDS, MAX_MPS) || 1;
    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const st = s.current;
      if (!st.scrubbing) {
        st.dist = Math.min(total, st.dist + (mps * st.speed * dt) / 1000);
        render(now, dt);
        if (st.dist >= total) { setPlaying(false); render(now, dt, true); return; }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, coords, total]);

  const toggle = () => {
    if (!playing && s.current.dist >= total) s.current.dist = 0; // replay from the start
    setPlaying(!playing);
  };
  const scrub = (e: Event) => {
    const f = Number((e.target as HTMLInputElement).value) / 1000;
    s.current.dist = f * total;
    render(performance.now(), 0, true);
  };

  const t = timeAt(dist);
  return (
    <div class="fly" role="dialog" aria-label="Flyover">
      <div class="fly-top">
        <div class="fly-title"><span class="fly-tag">Flyover</span><strong>{title}</strong></div>
        <button class="icon-btn raised" aria-label="Close flyover" onClick={onClose}><Close size={20} /></button>
      </div>
      <div class="fly-bar">
        {calm && !playing && dist === 0 && <div class="fly-note">Motion is reduced on this device, so the flyover starts paused. Press play to fly.</div>}
        <div class="fly-stats">
          <span><b>{km(dist)}</b> / {km(total)} km</span>
          {t !== null && <span><b>{clock(t)}</b> / {clock(times![times!.length - 1] ?? 0)}</span>}
        </div>
        <input class="fly-scrub" type="range" min={0} max={1000} step={1} value={total ? Math.round((dist / total) * 1000) : 0}
          aria-label="Flyover progress" onInput={scrub}
          onPointerDown={() => setScrubbing(true)} onPointerUp={() => setScrubbing(false)} onPointerCancel={() => setScrubbing(false)} />
        <div class="fly-controls">
          <button class="btn primary fly-play" onClick={toggle}>{playing ? "Pause" : dist >= total && total > 0 ? "Replay" : "Play"}</button>
          <div class="segmented fly-speed" role="group" aria-label="Speed">
            {SPEEDS.map((v) => (
              <button key={v} class={`seg${speed === v ? " active" : ""}`} aria-pressed={speed === v} onClick={() => setSpeed(v)}>{v}x</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
