/** Place and postal-code search through OneMap (SLA). */

export interface Place {
  name: string;
  address: string;
  postal: string;
  lat: number;
  lon: number;
}

const ONEMAP = "https://www.onemap.gov.sg/api/common/elastic/search";

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export async function searchPlaces(q: string, token?: string, fetchImpl: typeof fetch = fetch): Promise<Place[]> {
  const url = `${ONEMAP}?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  const res = await fetchImpl(url, { headers: token ? { Authorization: token } : {} });
  if (!res.ok) throw new Error(`OneMap ${res.status}`);
  const body = (await res.json()) as { results?: Record<string, string>[] };
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const r of body.results ?? []) {
    const lat = Number(r.LATITUDE), lon = Number(r.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = r.BUILDING && r.BUILDING !== "NIL" ? r.BUILDING : r.SEARCHVAL;
    out.push({
      name: title(name),
      address: title(r.ADDRESS ?? ""),
      postal: r.POSTAL && r.POSTAL !== "NIL" ? r.POSTAL : "",
      lat, lon,
    });
    if (out.length === 8) break;
  }
  return out;
}
