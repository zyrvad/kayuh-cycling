import { useEffect, useState } from "preact/hooks";
import { api, type FeedItem, type GroupRideSummary, type Ride } from "../api.ts";
import { dayStartMs, sgDay, type Goal } from "../fitness.ts";
import { conditions, me, mapIntent, myLocation, openGroupRide, openRide, refreshConditions, screen, rideDetail } from "../state.ts";
import { duration, km, sunset, timeOfDay } from "../util.ts";
import { Avatar, Page, TabBar } from "./common.tsx";
import { PlayIcon, RouteIcon } from "./Icons.tsx";
import { MiniMap } from "./Rides.tsx";
import { RouteCard } from "./RouteCard.tsx";
import { trainingOn } from "./Training.tsx";
import "./home.css";

const FALLBACK: [number, number] = [103.8198, 1.3521];
const sgHour = () => (new Date().getUTCHours() + 8) % 24;
const greet = () => { const h = sgHour(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const when = (iso: string) => new Date(iso).toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
function ago(iso: string) {
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(1, Math.round(m))} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

export function Home() {
  const m = me.value;
  const signedIn = !!m?.signedIn;
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [feed, setFeed] = useState<FeedItem | null | undefined>(undefined);
  const [group, setGroup] = useState<GroupRideSummary | null>(null);

  useEffect(() => { refreshConditions(myLocation.value ?? FALLBACK); }, []);
  useEffect(() => {
    if (!signedIn) { setRides(null); setGoals(null); setFeed(undefined); setGroup(null); return; }
    api.rides().then(setRides).catch(() => setRides([]));
    api.goals().then(setGoals).catch(() => setGoals([]));
    api.feed(null, 10).then((r) => setFeed(r.items.find((i) => !i.mine) ?? null)).catch(() => setFeed(null));
    api.groupRides().then((rs) => setGroup(rs.find((r) => r.myStatus !== "no") ?? null)).catch(() => {});
  }, [signedIn]);

  const first = (m?.displayName || "").trim().split(/\s+/)[0];
  const c = conditions.value;
  let cond: string | null = null;
  let warn = false;
  if (c && (c.forecast || c.tempC)) {
    const parts: string[] = [];
    if (c.forecast) parts.push(c.forecast.text);
    if (c.tempC) parts.push(`${Math.round(c.tempC.value)}°C`);
    parts.push(`Sunset ${timeOfDay(sunset(new Date()))}`);
    const hot = !!c.heat && /high|very|extreme/i.test(c.heat.level);
    warn = !!c.forecast?.rainLikely || hot;
    const why = c.forecast?.rainLikely ? "rain likely" : hot ? `heat ${c.heat!.level.toLowerCase()}` : "";
    cond = parts.join(" · ") + (why && !(c.forecast?.rainLikely && /rain|shower|thunder/i.test(c.forecast.text)) ? ` · ${why}` : "");
  }

  // Monday 00:00 Singapore time to now.
  const today = sgDay(Date.now());
  const wd = (((today + 3) % 7) + 7) % 7;
  const weekStart = dayStartMs(today - wd);
  const weekRides = (rides ?? []).filter((r) => Date.parse(r.riddenAt) >= weekStart);
  const weekKm = weekRides.reduce((a, r) => a + r.distanceM, 0) / 1000;
  const goal = goals?.find((g) => g.period === "week" && g.metric === "distance") ?? null;
  const frac = goal ? Math.min(1, weekKm / goal.target) : 0;
  const met = !!goal && weekKm >= goal.target;
  const R = 28.5, C = 2 * Math.PI * R;
  const last = rides?.[0] ? [...rides].sort((a, b) => Date.parse(b.riddenAt) - Date.parse(a.riddenAt))[0] : null;

  return (
    <>
      <Page title={signedIn && first ? `${greet()}, ${first}` : greet()}>
        <div class="home">
          {cond && <p class={warn ? "home-cond warn" : "home-cond"}>{cond}</p>}

          <div class="home-actions" data-tour="home-actions">
            <button class="home-action primary" onClick={() => { mapIntent.value = "search"; screen.value = "discover"; }}>
              <RouteIcon />
              <span><b>Plan a ride</b><small>Park connectors first</small></span>
            </button>
            <button class="home-action" onClick={() => (screen.value = "freeride")}>
              <PlayIcon />
              <span><b>Free ride</b><small>Record without a route</small></span>
            </button>
          </div>

          {signedIn && rides && (
            <div class="home-sec">
              <div class="home-week">
                <button class="home-week-hit" aria-label="Open rides" onClick={() => (screen.value = "rides")} />
                {goal && (
                  <span class="ring">
                    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
                      <circle cx="32" cy="32" r={R} fill="none" stroke="var(--line)" stroke-width="7" />
                      <circle cx="32" cy="32" r={R} fill="none" stroke={met ? "var(--warm)" : "var(--accent)"} stroke-width="7" stroke-linecap="round"
                        stroke-dasharray={`${C * frac} ${C}`} />
                    </svg>
                  </span>
                )}
                <span class="grow">
                  <span class="big">{weekKm.toFixed(1)} km this week</span>
                  <span class="sub">{goal ? `of ${goal.target} km goal · ` : ""}{weekRides.length} ride{weekRides.length === 1 ? "" : "s"}</span>
                </span>
                {!goal && (
                  <button class="btn tertiary sm home-week-goal" onClick={() => { trainingOn.value = true; screen.value = "rides"; }}>Set a goal</button>
                )}
              </div>
            </div>
          )}

          {signedIn && (
            <div class="home-sec">
              <div class="home-sec-head">
                <h2>Last ride</h2>
                <button class="btn tertiary" onClick={() => (screen.value = "rides")}>All rides</button>
              </div>
              {rides === null ? <div class="home-last-skel" /> : last ? (
                <RouteCard polyline={last.polyline} aspect={2.4} title={last.name} tierM={last.tierM}
                  meta={`${when(last.riddenAt)} · ${km(last.distanceM)} km · ${duration(last.timeS)}`}
                  onOpen={() => { rideDetail.value = { id: last.id }; screen.value = "rides"; }} />
              ) : <p class="home-empty">No rides yet. Plan one or start a free ride.</p>}
            </div>
          )}

          {signedIn && (group || feed !== undefined) && (
            <div class="home-sec">
              <div class="home-sec-head"><h2>Crew</h2></div>
              {group ? (
                <button class="home-row" onClick={() => openGroupRide(group.id)}>
                  <span class="txt">
                    <b>{group.title}</b>
                    <span>{new Date(group.startsAt).toLocaleString("en-SG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {group.meet.name}</span>
                    <span>{group.going} going{group.crewName ? ` · ${group.crewName}` : ""}</span>
                  </span>
                </button>
              ) : feed ? (
                <button class="home-row" onClick={() => openRide(feed.id, true)}>
                  <Avatar name={feed.rider.name} url={feed.rider.avatar} />
                  <span class="txt">
                    <b>{feed.rider.name} rode {km(feed.distanceM)} km</b>
                    <span>{feed.name}</span>
                    <span>{ago(feed.riddenAt)}</span>
                  </span>
                  <span class="thumb"><MiniMap polyline={feed.polyline} size={56} /></span>
                </button>
              ) : <p class="home-empty">Nothing from your crew yet.</p>}
            </div>
          )}

          {!signedIn && me.value && <p class="home-empty">Sign in from your profile to see your rides and crew here.</p>}
        </div>
      </Page>
      <TabBar />
    </>
  );
}
