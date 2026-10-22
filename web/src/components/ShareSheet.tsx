import { useEffect, useState } from "preact/hooks";
import { api, type CrewSummary } from "../api.ts";
import { me, refreshMe, screen, showToast } from "../state.ts";
import { Close, Share, TabCrew } from "./Icons.tsx";

/**
 * One place to share a route: with any of your crews (it shows on the crew page),
 * as a group ride with a date, or as a link for anyone.
 */
export function ShareSheet({ name, summary, routeId, onGroupRide, onClose }: {
  name: string;
  summary: string;
  /** The saved route's id, saving it first if needed. */
  routeId: () => Promise<string>;
  onGroupRide?: () => void;
  onClose: () => void;
}) {
  const [crews, setCrews] = useState<CrewSummary[] | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const signedIn = me.value?.signedIn;

  useEffect(() => {
    if (!me.value) refreshMe();
    api.crews().then(setCrews).catch(() => setCrews([]));
  }, []);

  const toCrew = async (c: CrewSummary) => {
    setBusy(c.id);
    try {
      await api.shareRouteToCrew(c.id, await routeId(), note.trim() || undefined);
      setDone(new Set(done).add(c.id));
      showToast(`Shared with ${c.name}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't share this route");
    } finally {
      setBusy(null);
    }
  };

  const asLink = async () => {
    setBusy("link");
    try {
      const { token } = await api.shareRoute(await routeId());
      const url = `${location.origin}/r/${token}`;
      if (navigator.share) await navigator.share({ title: "Kayuh route", text: `${name}: ${summary}`, url }).catch(() => {});
      else {
        await navigator.clipboard?.writeText(url);
        showToast("Share link copied");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't make a link");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="sheet-full" role="dialog" aria-label="Share route">
      <div class="search-head">
        <strong class="lg grow" style={{ alignSelf: "center" }}>Share route</strong>
        <button class="icon-btn" aria-label="Close" onClick={onClose}><Close /></button>
      </div>
      <div class="form-body">
        <div class="share-summary">
          <strong>{name}</strong>
          <span class="muted small">{summary}</span>
        </div>

        <section class="stack-8">
          <h2 class="section-title">With your crew</h2>
          {signedIn === false && (
            <div class="banner info">Sign in to share with friends. <button class="link-btn" onClick={() => { onClose(); screen.value = "crew"; }}>Open Crew</button></div>
          )}
          {signedIn && crews?.length === 0 && (
            <div class="banner info">You're not in a crew yet. <button class="link-btn" onClick={() => { onClose(); screen.value = "crew"; }}>Start one</button></div>
          )}
          {!!crews?.length && (
            <>
              <label class="field"><span>Note (optional)</span>
                <input maxLength={200} value={note} placeholder="Sunset ride, anyone?" onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
              </label>
              <ul class="list">
                {crews.map((c) => (
                  <li key={c.id} class="list-card share-row">
                    <span class="avatar"><TabCrew /></span>
                    <span class="list-main"><strong>{c.name}</strong><span class="muted small">{c.members} member{c.members === 1 ? "" : "s"}</span></span>
                    <button class={done.has(c.id) ? "btn outline" : "btn primary"} disabled={busy === c.id} onClick={() => toCrew(c)}>
                      {done.has(c.id) ? "Shared ✓" : busy === c.id ? "Sharing…" : "Share"}
                    </button>
                  </li>
                ))}
              </ul>
              <p class="muted small">It shows under Shared routes on the crew page, where anyone in the crew can open it in the planner.</p>
            </>
          )}
        </section>

        {onGroupRide && (
          <button class="btn outline" onClick={onGroupRide}>Plan a group ride with a date</button>
        )}
        <button class="btn outline" disabled={busy === "link"} onClick={asLink}><Share size={18} /> Send a link instead</button>
        <p class="muted small">For WhatsApp or Telegram. Only friends who can sign in to Kayuh can open it.</p>
      </div>
    </div>
  );
}
