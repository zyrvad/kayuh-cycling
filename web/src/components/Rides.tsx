import { useEffect, useMemo, useState } from "preact/hooks";
import type { LonLat } from "@kayuh/router";
import { api, type CrewRide, type Ride, type RideDetail } from "../api.ts";
import type { MapView } from "../map.ts";
import { rideTitle } from "../places.ts";
import { me, rideDetail, showToast } from "../state.ts";
import { analyse, BEST_EFFORTS, BEST_LABEL, decodeTrack, speedColor, SPEED_LEGEND, type Analysis, type BestKey, type RideStats, type Sample } from "../track.ts";
import { clock, decodePolyline, duration, km, TIER_COLORS, TIER_LABELS } from "../util.ts";
import { Avatar, Page, Sheet, TabBar, TierBar } from "./common.tsx";
import { Back, Trash } from "./Icons.tsx";
import { openSaved } from "./Tabs.tsx";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
const partOfDay = (iso: string) => {
  const h = new Date(iso).getHours();
  return h < 5 ? "Night" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : h < 20 ? "Evening" : "Night";
};

/** "Bukit Panjang → Springleaf", with generic labels like "My location" replaced by a landmark. */
function useTitle(name: string, polyline: string): string {
  const [title, setTitle] = useState(name);
  useEffect(() => {
    const pts = decodePolyline(polyline);
    let live = true;
    rideTitle(name, pts[0], pts[pts.length - 1]).then((t) => live && setTitle(t));
    return () => { live = false; };
  }, [name, polyline]);
  return title;
}

// ------------------------------------------------------------------ list

export function RidesTab({ map }: { map: MapView | null }) {
  const [view, setView] = useState<"mine" | "crew">("mine");
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [crew, setCrew] = useState<CrewRide[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => api.rides().then((r) => { setRides(r); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, []);
  const open = rideDetail.value;
  useEffect(() => {
    if ((view !== "crew" && !open?.crew) || crew) return;
    api.crewFeed().then(setCrew).catch((e) => {
      setCrew([]);
      if (e.status !== 401) setError(e.message);
    });
  }, [view, open?.crew]);

  if (open) {
    const crewRide = open.crew ? crew?.find((r) => r.id === open.id) : undefined;
    return <RideDetailPage key={open.id} id={open.id} crew={!!open.crew} crewRide={crewRide} crewLoaded={!!crew} all={rides ?? []} map={map} onChange={reload} />;
  }

  const total = (rides ?? []).reduce((a, r) => a + r.distanceM, 0);
  const pcn = (rides ?? []).reduce((a, r) => a + r.tierM[0], 0);
  const toggle = async (r: Ride) => {
    await api.setRideVisibility(r.id, r.visibility === "private" ? "crew" : "private").catch((e) => showToast(e.message));
    reload();
  };
  return (
    <>
      <Page title="Rides">
        {error && <div class="banner warn">{error}</div>}
        <div class="segmented" role="group" aria-label="Whose rides">
          <button class={view === "mine" ? "seg active" : "seg"} aria-pressed={view === "mine"} onClick={() => setView("mine")}>Mine</button>
          <button class={view === "crew" ? "seg active" : "seg"} aria-pressed={view === "crew"} onClick={() => setView("crew")}>Crew</button>
        </div>
        {view === "mine" ? (
          <>
            <div class="stat-tiles">
              <div><span class="big">{km(total)}</span><small>km ridden</small></div>
              <div><span class="big">{km(pcn)}</span><small>km on park connectors</small></div>
              <div><span class="big">{rides?.length ?? 0}</span><small>rides</small></div>
            </div>
            <p class="muted small">Rides are private. Tap <strong>Private</strong> on one to share it with your crews: the first and last 200 m always stay hidden.</p>
            {rides?.length === 0 && <p class="muted">Rides you start from a planned route show up here, with the full map and stats.</p>}
            <ul class="list">
              {rides?.map((r) => (
                <li key={r.id}>
                  <RideCard ride={r} onOpen={() => (rideDetail.value = { id: r.id })}
                    action={<button class="pill-btn" aria-pressed={r.visibility === "crew"} onClick={(e) => { e.stopPropagation(); toggle(r); }}>{r.visibility === "crew" ? "Crew" : "Private"}</button>} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {me.value && !me.value.signedIn && <div class="banner info">Sign in from the Crew tab to see rides your crew shares.</div>}
            {crew?.length === 0 && me.value?.signedIn && <p class="muted">Nothing shared yet. When someone in your crews shares a ride, it shows up here.</p>}
            <ul class="list">
              {crew?.map((r) => (
                <li key={r.id}><RideCard ride={r} rider={r.rider} avatar={r.avatar} onOpen={() => (rideDetail.value = { id: r.id, crew: true })} /></li>
              ))}
            </ul>
          </>
        )}
      </Page>
      <TabBar />
    </>
  );
}

function RideCard({ ride, rider, avatar, onOpen, action }: {
  ride: Ride | CrewRide; rider?: string; avatar?: string | null; onOpen: () => void; action?: preact.ComponentChildren;
}) {
  const title = useTitle(ride.name, ride.polyline);
  const st = ride.stats;
  return (
    <div class="list-card ride-card-row" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
      <div class="list-main">
        {rider && <span class="row gap-6 small muted"><Avatar name={rider} url={avatar} class="sm" />{rider}</span>}
        <strong>{title}</strong>
        <span class="muted">{dateLabel(ride.riddenAt)} · {partOfDay(ride.riddenAt)}</span>
        <span class="ride-figures">
          <span><b>{km(ride.distanceM)}</b> km</span>
          <span><b>{duration(st?.movingS ?? ride.timeS)}</b></span>
          {st && <span><b>{st.avgKmh.toFixed(1)}</b> km/h</span>}
        </span>
        <TierBar tierM={ride.tierM} height={6} />
      </div>
      <div class="ride-card-side">
        <MiniMap polyline={ride.polyline} />
        {action}
      </div>
    </div>
  );
}

/** A small drawing of the ride's shape (no map tiles: dozens of these must stay cheap). */
function MiniMap({ polyline, size = 76 }: { polyline: string; size?: number }) {
  const d = useMemo(() => {
    const pts = decodePolyline(polyline);
    if (pts.length < 2) return null;
    const step = Math.max(1, Math.floor(pts.length / 200));
    const ps = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    const k = Math.cos((ps[0][1] * Math.PI) / 180);
    const xs = ps.map((p) => p[0] * k), ys = ps.map((p) => -p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const span = Math.max(x1 - x0, y1 - y0) || 1e-6, pad = 8, s = (size - 2 * pad) / span;
    const ox = pad + (size - 2 * pad - (x1 - x0) * s) / 2, oy = pad + (size - 2 * pad - (y1 - y0) * s) / 2;
    const P = ps.map((_, i) => [ox + (xs[i] - x0) * s, oy + (ys[i] - y0) * s]);
    return { path: P.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(""), a: P[0], b: P[P.length - 1] };
  }, [polyline, size]);
  return (
    <svg class="minimap" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {d && <>
        <path d={d.path} fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
        <path d={d.path} fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx={d.a[0]} cy={d.a[1]} r="3.5" fill="#17804F" stroke="#FFFFFF" stroke-width="1.5" />
        <circle cx={d.b[0]} cy={d.b[1]} r="3.5" fill="#1D2A23" stroke="#FFFFFF" stroke-width="1.5" />
      </>}
    </svg>
  );
}

// ------------------------------------------------------------------ detail

type Shown = (Ride | CrewRide) & { track?: RideDetail["track"] };

function RideDetailPage({ id, crew, crewRide, crewLoaded, all, map, onChange }: {
  id: string; crew: boolean; crewRide?: CrewRide; crewLoaded: boolean; all: Ride[]; map: MapView | null; onChange: () => void;
}) {
  const [ride, setRide] = useState<Shown | null>(crewRide ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (crewRide) setRide(crewRide);
    else if (crew && crewLoaded) setError("This ride isn't shared with you any more.");
  }, [crewRide, crewLoaded]);
  const [colour, setColour] = useState<"speed" | "path">("speed");
  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => { if (!crew) api.ride(id).then(setRide).catch((e) => setError(e.message)); }, [id]);

  const samples: Sample[] | null = useMemo(() => (ride?.track ? decodeTrack(ride.track) : null), [ride]);
  const a: Analysis | null = useMemo(() => (samples && samples.length > 1 ? analyse(samples, ride?.track?.L) : null), [samples]);
  const line: LonLat[] = useMemo(() => (samples ? samples.map((s) => s.ll) : ride ? decodePolyline(ride.polyline) : []), [samples, ride]);
  const title = useTitle(ride?.name ?? "Ride", ride?.polyline ?? "");

  // Draw the ride on the map (which this page shows, free to pan, zoom and rotate) and frame it above the panel.
  useEffect(() => {
    if (!map || line.length < 2) return;
    let runs: { coords: LonLat[]; color: string }[];
    if (samples && a) {
      const colourOf = (i: number) => colour === "speed" ? speedColor(a.speed[i]) : samples[i].tier >= 0 ? TIER_COLORS[samples[i].tier] : "#8D9891";
      runs = [];
      for (let i = 0; i < samples.length; i++) {
        const c = colourOf(i), lastRun = runs[runs.length - 1];
        if (lastRun && lastRun.color === c) lastRun.coords.push(samples[i].ll);
        else runs.push({ coords: lastRun ? [lastRun.coords[lastRun.coords.length - 1], samples[i].ll] : [samples[i].ll], color: c });
      }
    } else runs = [{ coords: line, color: "#17804F" }];
    map.setTrack(runs);
    return () => { map.setTrack(null); };
  }, [map, line, colour, a]);
  useEffect(() => {
    if (map && line.length > 1) map.fitCoords(line, { top: 90, bottom: Math.round(window.innerHeight * 0.5), left: 30, right: 30 });
  }, [map, line]);
  useEffect(() => {
    map?.setMe(cursor !== null && samples ? samples[cursor].ll : null);
    return () => { map?.setMe(null); };
  }, [cursor]);

  const st: RideStats | null | undefined = a ?? ride?.stats;
  const mine = !crew;
  const sameRoute = mine && ride && "routeId" in ride && ride.routeId
    ? all.filter((r) => r.routeId === (ride as Ride).routeId).sort((x, y) => (x.stats?.movingS ?? x.timeS) - (y.stats?.movingS ?? y.timeS))
    : [];

  return (
    <>
      <button class="icon-btn raised detail-back" aria-label="Back to rides" onClick={() => (rideDetail.value = null)}><Back /></button>
      {a && (
        <div class="segmented detail-colour" role="group" aria-label="Colour the line by">
          <button class={colour === "speed" ? "seg active" : "seg"} aria-pressed={colour === "speed"} onClick={() => setColour("speed")}>Speed</button>
          <button class={colour === "path" ? "seg active" : "seg"} aria-pressed={colour === "path"} onClick={() => setColour("path")}>Path type</button>
        </div>
      )}
      <Sheet class="sheet detail-sheet" peek={170}>
        {error && <div class="banner warn">{error}</div>}
        {!ride && !error && <p class="muted center pad">Loading ride…</p>}
        {ride && (
          <>
            <div class="stack-2">
              {crewRide && <span class="row gap-6 small muted"><Avatar name={crewRide.rider} url={crewRide.avatar} class="sm" />{crewRide.rider}</span>}
              <strong class="detail-title">{title}</strong>
              <span class="muted">{dateLabel(ride.riddenAt)} · {new Date(ride.riddenAt).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" })}</span>
            </div>
            {a && colour === "speed" && (
              <div class="speed-legend" aria-label="Speed colours, km/h">
                {SPEED_LEGEND.map(([c, l]) => <span key={l}><i style={{ background: c }} />{l}</span>)}<span class="muted">km/h</span>
              </div>
            )}

            <div class="detail-grid">
              <Stat label="Distance" value={km(st?.distanceM ?? ride.distanceM)} unit="km" />
              <Stat label="Moving time" value={duration(st?.movingS ?? ride.timeS)} />
              <Stat label="Avg speed" value={st ? st.avgKmh.toFixed(1) : kmhStr(ride.distanceM, ride.timeS)} unit="km/h" />
              {st && <Stat label="Top speed" value={st.maxKmh.toFixed(1)} unit="km/h" />}
              {st?.elevGainM !== undefined && <Stat label="Climbing" value={String(st.elevGainM)} unit="m" />}
              <Stat label="Elapsed" value={duration(st?.elapsedS ?? ride.timeS)} />
              {st && <Stat label="Stops" value={String(st.stops)} unit={st.stoppedS >= 60 ? `· ${duration(st.stoppedS)}` : ""} />}
              {"predictedS" in ride && ride.predictedS ? <Stat label="vs Kayuh's estimate" value={vsEstimate(st?.movingS ?? ride.timeS, ride.predictedS)} /> : null}
            </div>
            <TierBar tierM={ride.tierM} labels />

            {a && samples && (
              <section class="stack-8">
                <h2 class="section-title">Speed</h2>
                <Chart a={a} values={a.speed} unit="km/h" color="var(--accent)" cursor={cursor} onCursor={setCursor} />
                {a.elevation && (
                  <>
                    <h2 class="section-title">Elevation</h2>
                    <Chart a={a} values={a.elevation} unit="m" color="#8D7A5A" cursor={cursor} onCursor={setCursor} />
                  </>
                )}
              </section>
            )}

            {st?.bests && Object.keys(st.bests).length > 0 && (
              <section class="stack-8">
                <h2 class="section-title">Best efforts</h2>
                <ul class="effort-list">
                  {BEST_EFFORTS.map((d) => String(d) as BestKey).filter((k) => st.bests[k]).map((k) => {
                    const rank = mine ? rankOf(all, id, k, st.bests[k]!) : 0;
                    return (
                      <li key={k}>
                        <span>{BEST_LABEL[k]}</span>
                        <strong>{clock(st.bests[k]!)}</strong>
                        <span class="muted small">{kmhStr(Number(k), st.bests[k]!)} km/h</span>
                        {rank > 0 && rank <= 3 && <span class={rank === 1 ? "pr-badge gold" : "pr-badge"}>{rank === 1 ? "PR" : rank === 2 ? "2nd best" : "3rd best"}</span>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {a && a.splits.length > 1 && (
              <section class="stack-8">
                <h2 class="section-title">Splits</h2>
                <table class="splits">
                  <thead><tr><th>km</th><th>Time</th><th>km/h</th><th class="bar-col" />{a.elevation && <th>Elev</th>}</tr></thead>
                  <tbody>
                    {a.splits.map((s) => {
                      const fastest = Math.max(...a.splits.map((x) => x.kmh));
                      return (
                        <tr key={s.km}>
                          <td>{s.distanceM < 990 ? (s.distanceM / 1000).toFixed(1) : s.km}</td>
                          <td>{clock(s.movingS)}</td>
                          <td>{s.kmh.toFixed(1)}</td>
                          <td class="bar-col"><span class="split-bar" style={{ width: `${(100 * s.kmh) / Math.max(1, fastest)}%`, background: speedColor(s.kmh) }} /></td>
                          {a.elevation && <td>{s.elevM === null ? "–" : `${s.elevM > 0 ? "+" : ""}${Math.round(s.elevM)}`}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            )}

            {a && a.byTier.length > 0 && (
              <section class="stack-8">
                <h2 class="section-title">Speed by path type</h2>
                <ul class="tier-speeds">
                  {a.byTier.map((t) => (
                    <li key={t.tier}><i style={{ background: TIER_COLORS[t.tier] }} /><span>{TIER_LABELS[t.tier]}</span>
                      <span class="muted">{km(t.distanceM)} km</span><strong>{t.kmh.toFixed(1)} km/h</strong></li>
                  ))}
                </ul>
              </section>
            )}

            {a && a.legs.length > 1 && (
              <section class="stack-8">
                <h2 class="section-title">Rental legs</h2>
                <ul class="tier-speeds">
                  {a.legs.map((l, i) => (
                    <li key={i}><b class="leg-num">{i + 1}</b><span>{km(l.distanceM)} km</span>
                      <span class={l.elapsedS > 30 * 60 ? "warn-text" : "muted"}>{clock(l.elapsedS)} on the bike</span><strong>{l.kmh.toFixed(1)} km/h</strong></li>
                  ))}
                </ul>
              </section>
            )}

            {sameRoute.length > 1 && (
              <section class="stack-8">
                <h2 class="section-title">This route, every time</h2>
                <ul class="tier-speeds">
                  {sameRoute.map((r, i) => (
                    <li key={r.id} class={r.id === id ? "this-ride" : ""} onClick={() => r.id !== id && (rideDetail.value = { id: r.id })}>
                      <b class="leg-num">{i + 1}</b><span>{dateLabel(r.riddenAt)}</span><span class="muted">{r.id === id ? "this ride" : ""}</span>
                      <strong>{duration(r.stats?.movingS ?? r.timeS)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!samples && mine && <p class="muted small">This ride was saved before Kayuh recorded GPS tracks, so it shows the planned line and no speed breakdown.</p>}

            {mine && (
              <div class="detail-actions">
                <button class="btn outline grow" onClick={async () => {
                  const r = ride as Ride;
                  await api.setRideVisibility(r.id, r.visibility === "private" ? "crew" : "private").catch((e) => showToast(e.message));
                  setRide({ ...r, visibility: r.visibility === "private" ? "crew" : "private" });
                  onChange();
                }}>{(ride as Ride).visibility === "crew" ? "Shared with crews · make private" : "Share with my crews"}</button>
                {(ride as Ride).routeId && (
                  <button class="btn primary grow" onClick={async () => {
                    const saved = (await api.routes().catch(() => [])).find((x) => x.id === (ride as Ride).routeId);
                    if (saved) { rideDetail.value = null; openSaved(saved); } else showToast("That saved route was deleted");
                  }}>Ride it again</button>
                )}
                <button class="mini-btn" aria-label="Delete this ride" onClick={async () => {
                  if (!confirm("Delete this ride? This can't be undone.")) return;
                  await api.deleteRide(id).catch((e) => showToast(e.message));
                  rideDetail.value = null;
                  onChange();
                }}><Trash /></button>
              </div>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}

const kmhStr = (m: number, s: number) => (s > 0 ? ((m / s) * 3.6).toFixed(1) : "–");

function vsEstimate(actual: number, predicted: number): string {
  const d = Math.round((actual - predicted) / 60);
  return d === 0 ? "On time" : d < 0 ? `${-d} min faster` : `${d} min slower`;
}

/** 1 = your fastest ever at this distance, 2 = second fastest, and so on. */
function rankOf(all: Ride[], id: string, k: BestKey, t: number): number {
  const others = all.filter((r) => r.id !== id).map((r) => r.stats?.bests?.[k]).filter((x): x is number => !!x);
  return 1 + others.filter((x) => x < t).length;
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return <div class="stat"><small>{label}</small><span><b>{value}</b>{unit ? ` ${unit}` : ""}</span></div>;
}

/** A line chart over distance. Drag across it to see the value there, and where it was on the map. */
function Chart({ a, values, unit, color, cursor, onCursor }: {
  a: Analysis; values: (number | null)[]; unit: string; color: string; cursor: number | null; onCursor: (i: number | null) => void;
}) {
  const W = 320, H = 96, total = a.cumM[a.cumM.length - 1] || 1;
  const vs = values.filter((v): v is number => v !== null);
  const lo = unit === "km/h" ? 0 : Math.min(...vs), hi = Math.max(...vs, lo + 1);
  const x = (i: number) => (a.cumM[i] / total) * W, y = (v: number) => H - 6 - ((v - lo) / (hi - lo)) * (H - 14);
  const pts = values.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
  const avg = unit === "km/h" ? a.avgKmh : null;
  const pick = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const m = ((e.clientX - r.left) / r.width) * total;
    let i = a.cumM.findIndex((c) => c >= m);
    if (i < 0) i = a.cumM.length - 1;
    onCursor(i);
  };
  return (
    <div class="chart">
      <div class="chart-readout">
        {cursor !== null && values[cursor] !== null
          ? <><b>{(values[cursor] as number).toFixed(unit === "m" ? 0 : 1)} {unit}</b><span class="muted"> at {km(a.cumM[cursor])} km</span></>
          : <span class="muted">{unit === "km/h" ? `max ${hi.toFixed(1)} · avg ${a.avgKmh.toFixed(1)} km/h` : `${Math.round(lo)}–${Math.round(hi)} m`}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="chart-svg"
        onPointerDown={pick} onPointerMove={(e) => e.buttons || e.pointerType === "touch" ? pick(e) : undefined} onPointerLeave={() => onCursor(null)}>
        <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill={color} opacity="0.15" />
        <polyline points={pts.join(" ")} fill="none" stroke={color} stroke-width="1.6" vector-effect="non-scaling-stroke" />
        {avg !== null && <line x1="0" x2={W} y1={y(avg)} y2={y(avg)} stroke="#56615B" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke" />}
        {cursor !== null && <line x1={x(cursor)} x2={x(cursor)} y1="0" y2={H} stroke="#15201A" stroke-width="1" vector-effect="non-scaling-stroke" />}
      </svg>
      <div class="chart-axis"><span>0</span><span>{km(total)} km</span></div>
    </div>
  );
}

