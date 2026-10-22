import { useEffect, useState } from "preact/hooks";
import { api, devEmail, type CrewDetail, type CrewRide, type CrewRoute, type CrewSummary, type GroupRideDetail, type GroupRideSummary, type RsvpStatus } from "../api.ts";
import {
  crewView, groupCap, me, mode, openCrew, openGroupRide, points, refreshMe, savedRouteId, screen, sharedName, showToast,
} from "../state.ts";
import { duration, km, OPERATOR_NAMES } from "../util.ts";
import { Page, TabBar, TierBar } from "./common.tsx";
import { Back, Share, Trash } from "./Icons.tsx";
import { openSaved } from "./Tabs.tsx";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const RSVP_LABEL: Record<RsvpStatus, string> = { going: "Going", maybe: "Maybe", no: "Can't" };

async function shareLink(title: string, url: string) {
  if (navigator.share) await navigator.share({ title, url }).catch(() => {});
  else {
    await navigator.clipboard?.writeText(url);
    showToast("Link copied");
  }
}

export function CrewTab() {
  useEffect(() => { if (!me.value) refreshMe(); }, []);
  const v = crewView.value;
  return (
    <>
      {!me.value ? <Page title="Crew"><p class="muted">Loading…</p></Page>
        : !me.value.signedIn ? <SignIn />
        : v.kind === "crew" ? <CrewPage id={v.id} />
        : v.kind === "ride" ? <GroupRidePage id={v.id} />
        : <CrewList />}
      <TabBar />
    </>
  );
}

function SignIn() {
  const local = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  const [email, setEmail] = useState(devEmail() ?? "");
  return (
    <Page title="Crew">
      <div class="empty-state">
        <strong class="lg">Sign in to ride with friends</strong>
        <p class="muted">Crews and group rides need an account so your friends can find you. Kayuh signs you in with a one-time
          code sent to your email: there's no password to remember.</p>
        <p class="muted">If you're not asked for your email when you open Kayuh, sign-in isn't switched on for this site yet.</p>
      </div>
      {local && (
        <form class="group" onSubmit={(e) => {
          e.preventDefault();
          try { localStorage.setItem("kayuh.devEmail", email.trim()); } catch { /* no storage */ }
          refreshMe();
        }}>
          <h2>Local testing</h2>
          <p class="muted small">On this development server you can pretend to be anyone.</p>
          <label class="field"><span>Email</span>
            <input type="email" required value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} placeholder="you@example.com" />
          </label>
          <button class="btn primary">Sign in (dev)</button>
        </form>
      )}
    </Page>
  );
}

function RideCard({ r }: { r: GroupRideSummary }) {
  return (
    <button class="list-card ride-card-btn" onClick={() => openGroupRide(r.id)}>
      <div class="list-main">
        <span class="eyebrow">{when(r.startsAt)}{r.crewName ? ` · ${r.crewName}` : ""}</span>
        <strong>{r.title}</strong>
        <span class="muted">{km(r.distanceM)} km · {duration(r.timeS)} · meet at {r.meet.name}</span>
        <span class="muted">{r.going} going{r.myStatus ? ` · you: ${RSVP_LABEL[r.myStatus]}` : " · you haven't answered"}</span>
      </div>
    </button>
  );
}

function CrewList() {
  const [crews, setCrews] = useState<CrewSummary[] | null>(null);
  const [rides, setRides] = useState<GroupRideSummary[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    api.crews().then(setCrews).catch((e) => setError(e.message));
    api.groupRides().then(setRides).catch(() => {});
  };
  useEffect(load, []);

  return (
    <Page title="Crew">
      {error && <div class="banner warn">{error}</div>}
      {rides.length > 0 && (
        <section class="stack-8">
          <h2 class="section-title">Coming up</h2>
          <ul class="list">{rides.map((r) => <li key={r.id}><RideCard r={r} /></li>)}</ul>
        </section>
      )}
      <section class="stack-8">
        <h2 class="section-title">Your crews</h2>
        {crews?.length === 0 && <p class="muted">No crews yet. Start one and send your friends the invite link.</p>}
        <ul class="list">
          {crews?.map((c) => (
            <li key={c.id}>
              <button class="list-card ride-card-btn" onClick={() => openCrew(c.id)}>
                <div class="list-main">
                  <strong>{c.name}</strong>
                  <span class="muted">{c.members} member{c.members === 1 ? "" : "s"}{c.nextRide ? ` · next ride ${when(c.nextRide)}` : ""}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <form class="group" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const c = await api.createCrew(name.trim());
          setName("");
          openCrew(c.id);
        } catch (err) { setError((err as Error).message); }
      }}>
        <h2>Start a crew</h2>
        <label class="field"><span>Name</span>
          <input required maxLength={40} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Sunday kakis" />
        </label>
        <button class="btn primary">Create crew</button>
      </form>
      <form class="group" onSubmit={async (e) => {
        e.preventDefault();
        try {
          const j = await api.joinCrew(code.trim().replace(/.*\/join\//, ""));
          showToast(`You joined ${j.name}`);
          openCrew(j.crewId);
        } catch (err) { setError((err as Error).message); }
      }}>
        <h2>Join a crew</h2>
        <label class="field"><span>Invite code or link</span>
          <input required value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} placeholder="ABCD2345" autoCapitalize="characters" />
        </label>
        <button class="btn outline">Join</button>
      </form>
    </Page>
  );
}

/** Open a crewmate's route in the planner. Saving it makes your own copy. */
function openCrewRoute(r: CrewRoute) {
  openSaved(r);
  savedRouteId.value = r.mine ? r.id : null;
  sharedName.value = r.mine ? null : r.name;
}

function CrewPage({ id }: { id: string }) {
  const [crew, setCrew] = useState<CrewDetail | null>(null);
  const [shared, setShared] = useState<CrewRide[]>([]);
  const [routes, setRoutes] = useState<CrewRoute[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    api.crew(id).then(setCrew).catch((e) => setError(e.message));
    api.crewRides(id).then(setShared).catch(() => {});
    api.crewRoutes(id).then(setRoutes).catch(() => {});
  };
  useEffect(load, [id]);
  const invite = crew ? `${location.origin}/join/${crew.inviteCode}` : "";

  return (
    <Page title={crew?.name ?? "Crew"}>
      <button class="link-btn back-link" onClick={() => (crewView.value = { kind: "list" })}><Back size={16} /> All crews</button>
      {error && <div class="banner warn">{error}</div>}
      {crew && (
        <>
          <section class="group">
            <h2>Invite friends</h2>
            <p class="muted small">Anyone with this link can join {crew.name} once they've signed in.</p>
            <div class="invite-row">
              <code class="invite-code">{crew.inviteCode}</code>
              <button class="btn primary" onClick={() => shareLink(`Join ${crew.name} on Kayuh`, invite)}><Share size={18} /> Share link</button>
            </div>
            {crew.role === "owner" && (
              <button class="link-btn" onClick={async () => {
                if (!confirm("Make a new invite link? The current one will stop working.")) return;
                await api.newInvite(id).catch((e) => showToast(e.message));
                load();
              }}>Make a new link</button>
            )}
          </section>

          <section class="stack-8">
            <h2 class="section-title">Shared routes</h2>
            {routes.length === 0 && <p class="muted small">Plan a route, then tap <strong>Share with your crew</strong>. Saved routes have a share button too.</p>}
            <ul class="list">
              {routes.map((r) => (
                <li key={r.id} class="list-card">
                  <button class="list-main" onClick={() => openCrewRoute(r)}>
                    <strong>{r.name}</strong>
                    <span class="muted">{r.mine ? "You" : r.sharedBy} · {km(r.distanceM)} km · {duration(r.timeS)}</span>
                    {r.note && <span class="notes small">{r.note}</span>}
                    <TierBar tierM={r.tierM} height={6} />
                  </button>
                  {r.canRemove && (
                    <button class="mini-btn" aria-label={`Remove ${r.name} from ${crew.name}`} onClick={async () => {
                      if (!confirm(`Remove "${r.name}" from ${crew.name}? It stays in ${r.mine ? "your" : `${r.sharedBy}'s`} saved routes.`)) return;
                      await api.unshareCrewRoute(id, r.id).catch((e) => showToast(e.message));
                      load();
                    }}><Trash /></button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section class="stack-8">
            <h2 class="section-title">Group rides</h2>
            {crew.rides.length === 0 && <p class="muted">Nothing planned. Share a route, then tap <strong>Plan a group ride with a date</strong>.</p>}
            <ul class="list">{crew.rides.map((r) => <li key={r.id}><RideCard r={r} /></li>)}</ul>
          </section>

          <section class="group">
            <h2>Members</h2>
            <ul class="members">
              {crew.members.map((m) => (
                <li key={m.id}>
                  <span class="avatar">{m.name.slice(0, 1).toUpperCase()}</span>
                  <span class="stack-2"><strong>{m.name}{m.me ? " (you)" : ""}</strong>
                    <span class="muted small">{OPERATOR_NAMES[m.operator]}{m.operator !== "own" ? ` · ${m.capMinutes} min free` : ""}{m.role === "owner" ? " · owner" : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section class="stack-8">
            <h2 class="section-title">Shared rides</h2>
            {shared.length === 0 && <p class="muted small">Rides are private. Share one from the Rides tab and your crew will see it here.</p>}
            <ul class="list">
              {shared.map((r) => (
                <li key={r.id} class="list-card">
                  <div class="list-main">
                    <strong>{r.name}</strong>
                    <span class="muted">{r.rider} · {new Date(r.riddenAt).toLocaleDateString("en-SG", { day: "numeric", month: "short" })} · {km(r.distanceM)} km</span>
                    <TierBar tierM={r.tierM} height={6} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <button class="btn outline" onClick={async () => {
            if (!confirm(`Leave ${crew.name}?`)) return;
            await api.leaveCrew(id).catch((e) => showToast(e.message));
            crewView.value = { kind: "list" };
          }}>Leave crew</button>
        </>
      )}
    </Page>
  );
}

function GroupRidePage({ id }: { id: string }) {
  const [ride, setRide] = useState<GroupRideDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.groupRide(id).then(setRide).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);
  const mine = ride?.people.find((p) => p.me)?.status ?? null;

  const openRoute = () => {
    if (!ride) return;
    mode.value = "ab";
    points.value = ride.route.points.map((ll, i) => ({
      ll, label: i === 0 ? ride.meet.name : i === ride.route.points.length - 1 ? "Finish" : `Stop ${i}`,
    }));
    groupCap.value = ride.strictestCapMinutes;
    sharedName.value = ride.title;
    savedRouteId.value = null;
    screen.value = "plan";
  };

  return (
    <Page title={ride?.title ?? "Group ride"}>
      <button class="link-btn back-link" onClick={() => (ride ? openCrew(ride.crewId) : (crewView.value = { kind: "list" }))}>
        <Back size={16} /> {ride?.crewName ?? "Back"}
      </button>
      {error && <div class="banner warn">{error}</div>}
      {ride && (
        <>
          <section class="group">
            <span class="eyebrow">{when(ride.startsAt)}</span>
            <strong class="lg">Meet at {ride.meet.name}</strong>
            <div class="stats compact-stats">
              <div><span class="big">{km(ride.route.distanceM)}</span><span class="unit"> km</span></div>
              <div><span class="big">{duration(ride.route.timeS).replace(" min", "")}</span><span class="unit">{ride.route.timeS < 3600 ? " min" : ""}</span></div>
              <div class="muted">{ride.route.legs} leg{ride.route.legs === 1 ? "" : "s"}</div>
            </div>
            <TierBar tierM={ride.route.tierM} labels />
            {ride.strictestCapMinutes && (
              <div class="banner ok">Legs are split for the shortest free ride in the group: {ride.strictestCapMinutes} min.</div>
            )}
            {ride.notes && <p class="notes">{ride.notes}</p>}
            <div class="row gap-10">
              <button class="btn primary grow" onClick={openRoute}>Open route</button>
              <button class="btn outline grow" onClick={async () => {
                try {
                  const blob = await api.groupRideIcs(id);
                  const file = new File([blob], "kayuh-ride.ics", { type: "text/calendar" });
                  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] }).catch(() => {});
                  else {
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(file);
                    a.download = file.name;
                    a.click();
                  }
                } catch (e) { showToast((e as Error).message); }
              }}>Add to calendar</button>
            </div>
          </section>

          <section class="group">
            <h2>Are you coming?</h2>
            <div class="segmented" role="group" aria-label="Your answer">
              {(Object.keys(RSVP_LABEL) as RsvpStatus[]).map((s) => (
                <button key={s} class={mine === s ? "seg active" : "seg"} aria-pressed={mine === s}
                  onClick={async () => { await api.rsvp(id, s).catch((e) => showToast(e.message)); load(); }}>
                  <span class="seg-title">{RSVP_LABEL[s]}</span>
                </button>
              ))}
            </div>
            <ul class="members">
              {ride.people.map((p) => (
                <li key={p.id}>
                  <span class={`avatar ${p.status ?? "none"}`}>{p.name.slice(0, 1).toUpperCase()}</span>
                  <span class="stack-2"><strong>{p.name}{p.me ? " (you)" : ""}</strong>
                    <span class="muted small">{p.status ? RSVP_LABEL[p.status] : "No answer yet"} · {OPERATOR_NAMES[p.operator]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section class="row gap-10">
            <button class="btn outline grow" onClick={() => shareLink(ride.title, `${location.origin}/ride/${ride.id}`)}><Share size={18} /> Share</button>
            {ride.canDelete && (
              <button class="btn outline grow danger" onClick={async () => {
                if (!confirm("Cancel this group ride for everyone?")) return;
                await api.deleteGroupRide(id).catch((e) => showToast(e.message));
                openCrew(ride.crewId);
              }}>Cancel ride</button>
            )}
          </section>
        </>
      )}
    </Page>
  );
}
