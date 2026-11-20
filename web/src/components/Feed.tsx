/** The Crew tab's feed: your rides and the rides friends share with you, plus following people. */
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { api, type FeedItem, type FollowInfo, type Person } from "../api.ts";
import { screen, openRide, showToast } from "../state.ts";
import { duration, km } from "../util.ts";
import { Avatar } from "./common.tsx";
import { Close, Share } from "./Icons.tsx";
import { KudosButton, useTitle } from "./Rides.tsx";
import { RouteCard } from "./RouteCard.tsx";
import "./feed.css";

/** Which half of the Crew tab is showing. */
export const crewSegment = signal<"feed" | "crews">("feed");
/** The Friends panel (follow link, requests, who you follow). */
export const friendsOpen = signal(false);

/**
 * A follow link (/follow/<code>) opened the app: follow that person (or ask to), say so, and
 * show the Friends panel. Returns true if the URL was a follow link.
 */
export function handleFollowLink(): boolean {
  const m = location.pathname.match(/^\/follow\/([A-Za-z0-9]{6,20})$/);
  if (!m) return false;
  history.replaceState(null, "", "/");
  api.follow({ code: m[1] })
    .then((r) => {
      showToast(r.status === "accepted" ? `You're following ${r.user.name}` : `Asked to follow ${r.user.name}. They'll need to approve it.`);
      crewSegment.value = "feed";
      friendsOpen.value = true;
      screen.value = "crew";
    })
    .catch((e) => showToast(e.status === 401 ? "Sign in from the Crew tab, then open the follow link again" : e.message));
  return true;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-SG", { weekday: "short", day: "numeric", month: "short" })} · ${d.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" })}`;
};

export function Feed() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false); // a ref, so a scroll and a tap can't fetch the same page twice

  const load = async (before: string | null) => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const page = await api.feed(before);
      setItems((old) => (before && old ? [...old, ...page.items] : page.items));
      setNext(page.next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  useEffect(() => { load(null); }, []);
  // Reload when the Friends panel closes: following someone changes what's here.
  useEffect(() => { if (!friendsOpen.value && items) load(null); }, [friendsOpen.value]);

  // Load the next page as the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) load(next); }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, loading]);

  return (
    <>
      <div class="row between">
        <h2 class="section-title">Latest rides</h2>
        <button class="pill-btn" onClick={() => (friendsOpen.value = true)}>Friends</button>
      </div>
      {error && <div class="banner warn">{error}</div>}
      {items === null && !error && <p class="muted">Loading…</p>}
      {items?.length === 0 && (
        <div class="empty-state">
          <strong class="lg">Nothing here yet</strong>
          <p class="muted">Your rides show up here, and so do rides your crews and the people you follow choose to share.</p>
          <p class="muted">Tap <strong>Friends</strong> to send your follow link, or share one of your rides from the Rides tab.</p>
        </div>
      )}
      <ul class="feed-list">
        {items?.map((i) => <li key={i.id}><FeedCard item={i} /></li>)}
      </ul>
      {next && (
        <div ref={sentinel}>
          <button class="btn outline feed-more" disabled={loading} onClick={() => load(next)}>{loading ? "Loading…" : "Load more"}</button>
        </div>
      )}
      {friendsOpen.value && <Friends onClose={() => (friendsOpen.value = false)} />}
    </>
  );
}

function FeedCard({ item: i }: { item: FeedItem }) {
  const title = useTitle(i.name, i.polyline);
  const moving = i.stats?.movingS ?? i.timeS;
  const avg = i.stats?.avgKmh ?? (i.timeS > 0 ? (i.distanceM / i.timeS) * 3.6 : 0);
  const header = (
    <span class="feed-head">
      <Avatar name={i.rider.name} url={i.rider.avatar} />
      <span class="stack-2">
        <strong>{i.mine ? "You" : i.rider.name}</strong>
        <span class="muted small">{when(i.riddenAt)}{i.crews.length ? ` · ${i.crews.map((c) => c.name).join(", ")}` : ""}</span>
      </span>
    </span>
  );
  const stats = (
    <div class="feed-stats">
      <div><small>Distance</small><b>{km(i.distanceM)} km</b></div>
      <div><small>Moving time</small><b>{duration(moving)}</b></div>
      <div><small>Avg speed</small><b>{avg.toFixed(1)} km/h</b></div>
    </div>
  );
  const actions = (
    <>
      <KudosButton id={i.id} kudos={i.kudos} kudoed={i.kudoed} mine={i.mine} />
      <span class="muted small">{i.comments} comment{i.comments === 1 ? "" : "s"}</span>
    </>
  );
  const open = () => openRide(i.id, !i.mine);
  if (i.polyline) return <RouteCard polyline={i.polyline} title={title} meta={stats} header={header} onOpen={open} actions={actions} />;
  return (
    <article class="route-card">
      <button type="button" class="rc-open" onClick={open} aria-label={`Open ${title}`}>
        <div class="rc-header">{header}</div>
        <div class="rc-map feed-map-empty muted small" style={{ aspectRatio: "16 / 9" }}>Too short to show without giving away the start and finish</div>
        <div class="rc-body"><div class="rc-title">{title}</div><div class="rc-meta">{stats}</div></div>
      </button>
      <div class="rc-actions">{actions}</div>
    </article>
  );
}

// ------------------------------------------------------------------ friends

function Friends({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<FollowInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.followInfo().then(setInfo).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const link = info ? `${location.origin}/follow/${info.code}` : "";

  /** Run an action, then refresh the lists. */
  const act = (fn: () => Promise<unknown>, done?: string) => async () => {
    try {
      await fn();
      if (done) showToast(done);
    } catch (e) { showToast((e as Error).message); }
    load();
  };

  const shareLink = async () => {
    if (navigator.share) await navigator.share({ title: "Follow me on Kayuh", url: link }).catch(() => {});
    else {
      await navigator.clipboard?.writeText(link);
      showToast("Link copied");
    }
  };

  return (
    <div class="sheet-full" role="dialog" aria-label="Friends">
      <div class="search-head">
        <strong class="lg grow" style={{ alignSelf: "center" }}>Friends</strong>
        <button class="icon-btn" aria-label="Close" onClick={onClose}><Close /></button>
      </div>
      <div class="form-body">
        {error && <div class="banner warn">{error}</div>}
        {!info && !error && <p class="muted">Loading…</p>}
        {info && (
          <>
            <section class="group">
              <h2>Your follow link</h2>
              <p class="muted small">Send it to friends. Anyone with it can {info.privateAccount ? "ask to follow you" : "follow you"} once they've signed in.</p>
              <button class="btn primary" onClick={shareLink}><Share size={18} /> Share link</button>
              <button class="link-btn" onClick={async () => {
                if (!confirm("Make a new follow link? The current one will stop working. People already following you stay.")) return;
                await act(() => api.newFollowCode(), "New link made")();
              }}>Make a new link</button>
            </section>

            <label class="group toggle row">
              <input type="checkbox" checked={info.privateAccount}
                onChange={act(() => api.setPrivateAccount(!info.privateAccount), info.privateAccount ? "Anyone with your link can follow you now" : "You'll approve new followers")} />
              <span class="stack-2"><strong>Private account</strong>
                <span class="muted small">You approve each new follower. Followers only see rides you share with them.</span>
                <span class="muted small">People already following you stay until you remove them.</span></span>
            </label>

            {info.requests.length > 0 && (
              <People title="Asking to follow you" people={info.requests} actions={(p) => (
                <>
                  <button class="btn primary small-btn" onClick={act(() => api.acceptFollower(p.id), `${p.name} can follow you now`)}>Accept</button>
                  <button class="btn outline small-btn" onClick={act(() => api.declineFollower(p.id))}>Decline</button>
                </>
              )} />
            )}

            <People title="Following" people={[...info.following, ...info.outgoing]}
              empty="You're not following anyone yet. Open a friend's follow link, or follow a crewmate below."
              note={(p) => (info.outgoing.some((o) => o.id === p.id) ? "Waiting for them to approve" : null)}
              actions={(p) => {
                const waiting = info.outgoing.some((o) => o.id === p.id);
                return <button class="btn outline small-btn" onClick={async () => {
                  if (!waiting && !confirm(`Unfollow ${p.name}? You'll stop seeing rides they share with followers.`)) return;
                  await act(() => api.unfollow(p.id))();
                }}>{waiting ? "Cancel" : "Unfollow"}</button>;
              }} />

            <People title="Followers" people={info.followers} empty="No followers yet. Share your follow link to let friends see the rides you share with them."
              actions={(p) => (
                <button class="btn outline small-btn" onClick={async () => {
                  if (!confirm(`Remove ${p.name}? They'll stop seeing rides you share with followers.`)) return;
                  await act(() => api.removeFollower(p.id))();
                }}>Remove</button>
              )} />

            {info.suggestions.length > 0 && (
              <People title="From your crews" people={info.suggestions} actions={(p) => (
                <button class="btn primary small-btn" onClick={act(async () => {
                  const r = await api.follow({ userId: p.id });
                  showToast(r.status === "accepted" ? `You're following ${p.name}` : `Asked to follow ${p.name}`);
                })}>Follow</button>
              )} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function People({ title, people, empty, note, actions }: {
  title: string; people: Person[]; empty?: string; note?: (p: Person) => string | null; actions: (p: Person) => preact.ComponentChildren;
}) {
  return (
    <section class="stack-8">
      <h2 class="section-title">{title}</h2>
      {people.length === 0 && empty && <p class="muted small">{empty}</p>}
      <ul class="list">
        {people.map((p) => (
          <li key={p.id} class="list-card person-row">
            <Avatar name={p.name} url={p.avatar} />
            <span class="list-main"><strong>{p.name}</strong>{note?.(p) && <span class="muted small">{note(p)}</span>}</span>
            <span class="row person-actions">{actions(p)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
