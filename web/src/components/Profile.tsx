import { useEffect, useState } from "preact/hooks";
import { api, type FollowInfo, type Ride } from "../api.ts";
import { dayStartMs, sgDay } from "../fitness.ts";
import { me, refreshMe, rideDetail, screen, showToast } from "../state.ts";
import { duration, km } from "../util.ts";
import { Avatar, Page, TabBar } from "./common.tsx";
import { friendsOpen } from "./Feed.tsx";
import { Gear } from "./Icons.tsx";
import { RouteCard } from "./RouteCard.tsx";
import { useTitle } from "./Rides.tsx";
import "./profile.css";

const SG_MS = 8 * 3600_000;
const movingS = (r: Ride) => r.stats?.movingS ?? r.timeS;
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" });
const openRide = (id: string) => { rideDetail.value = { id }; screen.value = "rides"; };

function Totals({ title, rides }: { title: string; rides: Ride[] }) {
  const dist = rides.reduce((a, r) => a + r.distanceM, 0);
  const time = rides.reduce((a, r) => a + movingS(r), 0);
  return (
    <div class="stat-group">
      <h3>{title}</h3>
      <div class="big">{(dist / 1000).toFixed(1)}<small>km</small></div>
      <div class="sub">{rides.length} ride{rides.length === 1 ? "" : "s"} · {duration(time)}</div>
    </div>
  );
}

function RecentRide({ ride }: { ride: Ride }) {
  const title = useTitle(ride.name, ride.polyline);
  const meta = `${dateLabel(ride.riddenAt)} · ${km(ride.distanceM)} km · ${duration(movingS(ride))}`;
  return <RouteCard polyline={ride.polyline} title={title} meta={meta} tierM={ride.tierM} aspect={2} onOpen={() => openRide(ride.id)} />;
}

function Record({ num, unit, label, ride }: { num: string; unit: string; label: string; ride: Ride }) {
  return (
    <button class="pr-tile" onClick={() => openRide(ride.id)}>
      <span class="num">{num}<small>{unit}</small></span>
      <span class="txt"><b>{label}</b><span>{dateLabel(ride.riddenAt)}</span></span>
    </button>
  );
}

export function ProfilePage() {
  const m = me.value;
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [follow, setFollow] = useState<FollowInfo | null>(null);
  useEffect(() => { if (!m) refreshMe(); }, []);
  useEffect(() => {
    api.rides().then(setRides).catch(() => setRides([]));
    api.followInfo().then(setFollow).catch(() => {});
  }, [m?.signedIn]);

  const name = m?.displayName || m?.email || "Me";
  const all = rides ?? [];
  const today = sgDay(Date.now());
  const weekStart = dayStartMs(today - ((((today + 3) % 7) + 7) % 7));
  const year = new Date(Date.now() + SG_MS).getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1) - SG_MS;
  const week = all.filter((r) => Date.parse(r.riddenAt) >= weekStart);
  const thisYear = all.filter((r) => Date.parse(r.riddenAt) >= yearStart);

  const best = (list: Ride[], f: (r: Ride) => number | null): Ride | null => {
    let top: Ride | null = null, v = -Infinity;
    for (const r of list) { const x = f(r); if (x !== null && x > v) { top = r; v = x; } }
    return top;
  };
  const longest = best(all, (r) => r.distanceM);
  const fastest = best(all, (r) => (r.stats?.avgKmh ? r.stats.avgKmh : null));
  const greenest = best(all, (r) => (r.tierM?.[0] ? r.tierM[0] : null));

  const link = follow ? `${location.origin}/follow/${follow.code}` : "";
  const shareLink = async () => {
    if (!link) return showToast("Sign in to get your follow link");
    if (navigator.share) await navigator.share({ title: "Follow me on Kayuh", url: link }).catch(() => {});
    else { await navigator.clipboard?.writeText(link); showToast("Link copied"); }
  };
  const openFriends = () => { screen.value = "crew"; friendsOpen.value = true; };

  return (
    <>
      <Page title="Profile" profile={false} actions={
        <button class="icon-btn" aria-label="Settings" data-tour="settings-link" onClick={() => (screen.value = "settings")}><Gear /></button>
      }>
        <div class="profile-head" data-tour="profile">
          <Avatar name={name} url={m?.avatar} />
          <h2>{name}</h2>
          {m?.signedIn ? (
            <>
              <button class="profile-counts" onClick={openFriends} aria-label="Open friends">
                <b>{follow?.following.length ?? 0}</b> following · <b>{follow?.followers.length ?? 0}</b> followers
              </button>
              <button class="btn secondary sm" onClick={shareLink}>Share follow link</button>
            </>
          ) : (
            <p class="muted small">Sign in to keep rides on every device, follow friends and join crews.</p>
          )}
        </div>

        <div class="stat-groups">
          <Totals title="This week" rides={week} />
          <Totals title={`This year`} rides={thisYear} />
        </div>

        {all.length > 0 && (
          <>
            <h2>Personal records</h2>
            <div class="pr-list">
              {longest && <Record num={(longest.distanceM / 1000).toFixed(1)} unit="km" label="Longest ride" ride={longest} />}
              {fastest && <Record num={fastest.stats!.avgKmh.toFixed(1)} unit="km/h" label="Fastest average speed" ride={fastest} />}
              {greenest && <Record num={(greenest.tierM[0] / 1000).toFixed(1)} unit="km" label="Most park connector in a ride" ride={greenest} />}
            </div>
            <h2>Recent rides</h2>
            <ul class="rc-list">
              {all.slice(0, 3).map((r) => <li key={r.id}><RecentRide ride={r} /></li>)}
            </ul>
            <button class="btn tertiary" onClick={() => (screen.value = "rides")}>All rides</button>
          </>
        )}
      </Page>
      <TabBar />
    </>
  );
}
