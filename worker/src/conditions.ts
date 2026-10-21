/** Ride-day conditions from NEA real-time APIs on data.gov.sg (no key needed). */

const NEA = "https://api-open.data.gov.sg/v2/real-time/api";
const CACHE_S = 300;

export interface Conditions {
  forecast: { area: string; text: string; validUntil: string; rainLikely: boolean } | null;
  tempC: { value: number; station: string } | null;
  heat: { wbgt: number; level: string; station: string } | null;
}

interface LL { latitude: number | string; longitude: number | string }

const dist2 = (lat: number, lon: number, p: LL) => (Number(p.latitude) - lat) ** 2 + (Number(p.longitude) - lon) ** 2;

function nearest<T>(items: T[], lat: number, lon: number, loc: (t: T) => LL): T | null {
  let best: T | null = null, bestD = Infinity;
  for (const it of items) {
    const d = dist2(lat, lon, loc(it));
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

export type Fetcher = (url: string) => Promise<unknown>;

/** Fetch JSON through the Workers cache so a busy morning doesn't hammer data.gov.sg. */
export const cachedFetch: Fetcher = async (url) => {
  const cache = (globalThis as { caches?: { default: Cache } }).caches?.default;
  const key = new Request(url);
  const hit = cache && (await cache.match(key));
  if (hit) return hit.json();
  const res = await fetch(url, { headers: { "User-Agent": "kayuh/0.1" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const body = await res.text();
  if (cache) {
    await cache.put(key, new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_S}` } }));
  }
  return JSON.parse(body);
};

const RAINY = /shower|rain|thunder|drizzle/i;

export async function getConditions(lat: number, lon: number, fetchJson: Fetcher = cachedFetch): Promise<Conditions> {
  const [fc, temp, wbgt] = await Promise.allSettled([
    fetchJson(`${NEA}/two-hr-forecast`),
    fetchJson(`${NEA}/air-temperature`),
    fetchJson(`${NEA}/weather?api=wbgt`),
  ]);

  let forecast: Conditions["forecast"] = null;
  if (fc.status === "fulfilled") {
    const d = (fc.value as any).data;
    const area = nearest(d.area_metadata as { name: string; label_location: LL }[], lat, lon, (a) => a.label_location);
    const item = d.items?.[0];
    const f = item?.forecasts?.find((x: { area: string }) => x.area === area?.name);
    if (area && f) forecast = { area: area.name, text: f.forecast, validUntil: item.valid_period?.end ?? "", rainLikely: RAINY.test(f.forecast) };
  }

  let tempC: Conditions["tempC"] = null;
  if (temp.status === "fulfilled") {
    const d = (temp.value as any).data;
    const st = nearest(d.stations as { id: string; name: string; location: LL }[], lat, lon, (s) => s.location);
    const reading = d.readings?.[0]?.data?.find((r: { stationId: string }) => r.stationId === st?.id);
    if (st && reading) tempC = { value: reading.value, station: st.name };
  }

  let heat: Conditions["heat"] = null;
  if (wbgt.status === "fulfilled") {
    const readings = (wbgt.value as any).data?.records?.[0]?.item?.readings ?? [];
    const r = nearest(readings as { location: LL; wbgt: string; heatStress: string; station: { name: string } }[], lat, lon, (x) => x.location);
    if (r) heat = { wbgt: Number(r.wbgt), level: r.heatStress, station: r.station.name };
  }
  return { forecast, tempC, heat };
}
