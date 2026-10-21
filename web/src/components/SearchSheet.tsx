import { useEffect, useRef, useState } from "preact/hooks";
import { api, type Place } from "../api.ts";
import { locate, myLocation, pickIndex, setPoint } from "../state.ts";
import { Close, Locate, Pin, Search } from "./Icons.tsx";

/** Full-screen search for setting one point (start, a stop or the end). */
export function SearchSheet({ index, title, onClose }: { index: number; title: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (q.trim().length < 2) return setPlaces([]);
    const t = setTimeout(() => {
      api.search(q).then((p) => { setPlaces(p); setError(null); }).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (ll: [number, number], label: string) => {
    setPoint(index, { ll, label });
    onClose();
  };

  return (
    <div class="sheet-full" role="dialog" aria-label={title}>
      <div class="search-head">
        <label class="searchbox">
          <Search />
          <span class="sr">{title}</span>
          <input ref={input} type="search" value={q} placeholder="Place, address or postal code"
            onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
        <button class="icon-btn" aria-label="Close search" onClick={onClose}><Close /></button>
      </div>
      <div class="search-list">
        <button class="search-row" onClick={async () => {
          const ll = myLocation.value ?? (await locate());
          if (ll) pick(ll, "My location");
          else setError("Couldn't get your location. Allow location access, or pick on the map.");
        }}>
          <Locate /> <span><strong>My location</strong></span>
        </button>
        <button class="search-row" onClick={() => { pickIndex.value = index; onClose(); }}>
          <Pin /> <span><strong>Pick on the map</strong><small>Tap anywhere on the map</small></span>
        </button>
        {error && <p class="search-error">{error}</p>}
        {places.map((p) => (
          <button key={`${p.lat},${p.lon}`} class="search-row" onClick={() => pick([p.lon, p.lat], p.name)}>
            <Search size={18} />
            <span><strong>{p.name}</strong><small>{p.address}{p.postal ? ` · ${p.postal}` : ""}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}
