/**
 * Reading rides from other devices: GPX, TCX and FIT files (Garmin, Huawei, Zepp, Wahoo, Strava exports...).
 * No DOM and no browser APIs (XML is scanned with regexes, FIT is read with a DataView) so it runs in
 * node tests and, later, in a worker or an Expo app.
 */
import type { Sample } from "./track.ts";

export interface ImportedActivity {
  /** Absolute time of the first sample, ms since 1970. */
  startMs: number;
  /**
   * Samples in time order, t = whole seconds from startMs. A point the device logged without a position
   * (a heart-rate-only record, an indoor ride) has ll = [NaN, NaN]: keep it for mergeSensors, drop it
   * from the map with `positioned`. `tier` is -1 until the router classifies the points.
   */
  samples: Sample[];
  name?: string;
}

export const hasPosition = (s: Sample) => Number.isFinite(s.ll[0]) && Number.isFinite(s.ll[1]);
export const positioned = (samples: Sample[]) => samples.filter(hasPosition);

/** Detect the format from the bytes (FIT has ".FIT" at offset 8, else text starting with XML) and parse. */
export function parseActivity(data: ArrayBuffer | string): ImportedActivity {
  if (typeof data !== "string") {
    const b = new Uint8Array(data);
    if (b.length >= 12 && String.fromCharCode(b[8], b[9], b[10], b[11]) === ".FIT") return parseFit(data);
    data = new TextDecoder().decode(data);
  }
  if (/<TrainingCenterDatabase\b/i.test(data) || /<Trackpoint\b/i.test(data)) return parseTcx(data);
  if (/<gpx\b/i.test(data)) return parseGpx(data);
  throw new Error("Not a GPX, TCX or FIT file");
}

const num = (v: string | undefined) => {
  if (v === undefined) return null;
  const n = Number(v.trim());
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};
const whole = (v: number | null) => (v === null ? null : Math.round(v));
/** A sensor reading of 0 bpm or rpm means "no signal"; 0 W is real (coasting). */
const reading = (v: number | null, min: number) => (v !== null && v >= min && v <= 3000 ? Math.round(v) : null);

function ms(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = iso.trim();
  // A timestamp without a zone is taken as UTC, not whatever this device's zone is.
  const t2 = /(Z|[+-]\d\d:?\d\d)$/i.test(t) ? t : t + "Z";
  const v = Date.parse(t2);
  return Number.isNaN(v) ? null : v;
}

const unxml = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();

/** The text of the first <tag> in `xml`, with any namespace prefix on the tag. */
function tag(xml: string, name: string): string | undefined {
  return new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, "i").exec(xml)?.[1];
}
const attr = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);

/** Turn raw points (any order of fields) into samples relative to the first timestamp. */
interface Raw { ms: number; lon: number | null; lat: number | null; alt: number | null; hr: number | null; cad: number | null; power: number | null; kmh?: number | null }
function finish(raw: Raw[], name?: string): ImportedActivity {
  if (!raw.length) throw new Error("No timed track points found in this file");
  raw.sort((a, b) => a.ms - b.ms);
  const startMs = raw[0].ms;
  const samples: Sample[] = raw.map((r) => ({
    ll: r.lon !== null && r.lat !== null && Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180 ? [r.lon, r.lat] : [NaN, NaN],
    t: Math.round((r.ms - startMs) / 1000),
    alt: whole(r.alt),
    kmh: r.kmh === undefined || r.kmh === null ? null : Math.round(r.kmh * 10) / 10,
    tier: -1,
    hr: r.hr, cad: r.cad, power: r.power,
  }));
  return { startMs, samples, name: name || undefined };
}

// ------------------------------------------------------------------ GPX

export function parseGpx(xml: string): ImportedActivity {
  const raw: Raw[] = [];
  // <trkpt lat=".." lon="..">...</trkpt>, or self-closing (no time, so skipped anyway).
  for (const m of xml.matchAll(/<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt\s*>)/gi)) {
    const body = m[2] ?? "";
    const t = ms(tag(body, "time"));
    if (t === null) continue;
    const lat = num(attr(m[1], "lat")?.[1] ?? attr(m[1], "lat")?.[2]), lon = num(attr(m[1], "lon")?.[1] ?? attr(m[1], "lon")?.[2]);
    raw.push({
      ms: t, lon, lat, alt: num(tag(body, "ele")),
      hr: reading(num(tag(body, "hr")), 1), cad: reading(num(tag(body, "cad")), 1),
      power: reading(num(tag(body, "PowerInWatts") ?? tag(body, "power") ?? tag(body, "watts")), 0),
    });
  }
  // The track's own <name> (before its first segment), else the file's metadata name.
  const trk = /<trk\b[^>]*>([\s\S]*?)(?:<trkseg\b|<trkpt\b|$)/i.exec(xml)?.[1];
  const name = (trk && tag(trk, "name")) ?? tag(/<metadata\b[\s\S]*?<\/metadata>/i.exec(xml)?.[0] ?? "", "name");
  return finish(raw, name ? unxml(name) : undefined);
}

// ------------------------------------------------------------------ TCX

export function parseTcx(xml: string): ImportedActivity {
  const raw: Raw[] = [];
  for (const m of xml.matchAll(/<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint\s*>/gi)) {
    const body = m[1];
    const t = ms(tag(body, "Time"));
    if (t === null) continue;
    const pos = tag(body, "Position") ?? "";
    // HeartRateBpm wraps <Value>; Cadence is the plain element (RunCadence in extensions is ignored).
    const hr = tag(tag(body, "HeartRateBpm") ?? "", "Value");
    raw.push({
      ms: t, lat: num(tag(pos, "LatitudeDegrees")), lon: num(tag(pos, "LongitudeDegrees")), alt: num(tag(body, "AltitudeMeters")),
      hr: reading(num(hr), 1), cad: reading(num(tag(body, "Cadence")), 1), power: reading(num(tag(body, "Watts")), 0),
    });
  }
  const notes = tag(xml, "Notes");
  return finish(raw, notes ? unxml(notes) : undefined);
}

// ------------------------------------------------------------------ FIT

const FIT_EPOCH_MS = 631_065_600_000; // 1989-12-31T00:00:00Z
const SEMICIRCLE = 180 / 2 ** 31;

/** One field of a data message, read by its declared base type. null = the type's "invalid" value. */
function fitValue(dv: DataView, off: number, size: number, baseType: number, le: boolean): number | null {
  switch (baseType & 0x1f) {
    case 1: return size >= 1 && dv.getInt8(off) !== 0x7f ? dv.getInt8(off) : null;
    case 0: case 2: case 13: { const v = size >= 1 ? dv.getUint8(off) : 0xff; return v === 0xff ? null : v; }
    case 10: { const v = size >= 1 ? dv.getUint8(off) : 0; return v === 0 ? null : v; }
    case 3: return size >= 2 && dv.getInt16(off, le) !== 0x7fff ? dv.getInt16(off, le) : null;
    case 4: { const v = size >= 2 ? dv.getUint16(off, le) : 0xffff; return v === 0xffff ? null : v; }
    case 11: { const v = size >= 2 ? dv.getUint16(off, le) : 0; return v === 0 ? null : v; }
    case 5: return size >= 4 && dv.getInt32(off, le) !== 0x7fffffff ? dv.getInt32(off, le) : null;
    case 6: { const v = size >= 4 ? dv.getUint32(off, le) : 0xffffffff; return v === 0xffffffff ? null : v; }
    case 12: { const v = size >= 4 ? dv.getUint32(off, le) : 0; return v === 0 ? null : v; }
    default: return null;
  }
}

interface FitDef { global: number; le: boolean; fields: { num: number; size: number; type: number }[]; devSize: number; size: number }

export function parseFit(data: ArrayBuffer): ImportedActivity {
  const dv = new DataView(data);
  const raw: Raw[] = [];
  let pos = 0;
  // A file can hold several FIT "chains" back to back; read them all.
  while (pos + 12 <= dv.byteLength) {
    const headerSize = dv.getUint8(pos);
    if (headerSize < 12 || String.fromCharCode(dv.getUint8(pos + 8), dv.getUint8(pos + 9), dv.getUint8(pos + 10), dv.getUint8(pos + 11)) !== ".FIT") {
      if (pos === 0) throw new Error("Not a FIT file");
      break;
    }
    const end = Math.min(dv.byteLength, pos + headerSize + dv.getUint32(pos + 4, true));
    readFitMessages(dv, pos + headerSize, end, raw);
    pos = end + 2; // the trailing CRC
  }
  return finish(raw);
}

function readFitMessages(dv: DataView, start: number, end: number, out: Raw[]) {
  const defs: (FitDef | undefined)[] = [];
  let p = start, lastTs = 0;
  while (p < end) {
    const h = dv.getUint8(p++);
    let local: number, compressed = -1;
    if (h & 0x80) {
      // Compressed timestamp header: local type in bits 5-6, 5-bit time offset in bits 0-4.
      local = (h >> 5) & 3;
      compressed = h & 0x1f;
    } else if (h & 0x40) {
      // Definition message (bit 5 set = developer fields follow the normal ones).
      const le = dv.getUint8(p + 1) === 0;
      const nf = dv.getUint8(p + 4);
      const def: FitDef = { global: dv.getUint16(p + 2, le), le, fields: [], devSize: 0, size: 0 };
      let q = p + 5;
      for (let i = 0; i < nf; i++, q += 3) {
        const f = { num: dv.getUint8(q), size: dv.getUint8(q + 1), type: dv.getUint8(q + 2) };
        def.fields.push(f);
        def.size += f.size;
      }
      if (h & 0x20) {
        const nd = dv.getUint8(q++);
        for (let i = 0; i < nd; i++, q += 3) def.devSize += dv.getUint8(q + 1); // developer fields: skipped by size
      }
      defs[h & 0x0f] = def;
      p = q;
      continue;
    } else local = h & 0x0f;

    const def = defs[local];
    if (!def) throw new Error("Corrupt FIT file (data before its definition)");
    let ts: number | null = null, lat: number | null = null, lon: number | null = null;
    let alt: number | null = null, alt2: number | null = null, spd: number | null = null, spd2: number | null = null;
    let hr: number | null = null, cad: number | null = null, power: number | null = null;
    if (compressed >= 0) {
      ts = (lastTs & ~0x1f) + compressed;
      if (compressed < (lastTs & 0x1f)) ts += 0x20;
      lastTs = ts;
    }
    let q = p;
    for (const f of def.fields) {
      if (q + f.size > end) break;
      const v = fitValue(dv, q, f.size, f.type, def.le);
      if (f.num === 253 && f.size === 4 && v !== null) { ts = v; lastTs = v; }
      else if (def.global === 20) {
        switch (f.num) {
          case 0: lat = v === null ? null : v * SEMICIRCLE; break;
          case 1: lon = v === null ? null : v * SEMICIRCLE; break;
          case 2: alt = v === null ? null : v / 5 - 500; break;
          case 78: alt2 = v === null ? null : v / 5 - 500; break;
          case 3: hr = v; break;
          case 4: cad = v; break;
          case 6: spd = v === null ? null : (v / 1000) * 3.6; break;
          case 73: spd2 = v === null ? null : (v / 1000) * 3.6; break;
          case 7: power = v; break;
        }
      }
      q += f.size;
    }
    p += def.size + def.devSize;
    if (def.global === 20 && ts !== null) {
      out.push({
        ms: FIT_EPOCH_MS + ts * 1000, lat, lon, alt: alt2 ?? alt, kmh: spd2 ?? spd,
        hr: reading(hr, 1), cad: reading(cad, 1), power: reading(power, 0),
      });
    }
  }
}

// ------------------------------------------------------------------ merging

/** Gaps wider than this between a ride sample and the watch's nearest reading mean "no match". */
export const MERGE_WINDOW_S = 5;

/**
 * Copy heart rate, cadence and power from an imported activity onto the samples Kayuh recorded, matching by
 * absolute time (the nearest imported reading within 5 s). Existing readings are kept where the file has none.
 * Returns how many ride samples found a match.
 */
export function mergeSensors(rideSamples: Sample[], rideStartMs: number, imported: ImportedActivity): number {
  const src = imported.samples.filter((s) => s.hr !== null || s.cad !== null || s.power !== null);
  if (!src.length) return 0;
  const at = (s: Sample) => imported.startMs + s.t * 1000;
  let j = 0, matched = 0;
  for (const r of rideSamples) {
    const t = rideStartMs + r.t * 1000;
    while (j + 1 < src.length && at(src[j + 1]) <= t) j++;
    // The nearest is src[j] (the last at or before t) or src[j + 1] (the first after).
    let best = src[j];
    if (j + 1 < src.length && Math.abs(at(src[j + 1]) - t) < Math.abs(at(best) - t)) best = src[j + 1];
    if (Math.abs(at(best) - t) > MERGE_WINDOW_S * 1000) continue;
    r.hr = best.hr ?? r.hr;
    r.cad = best.cad ?? r.cad;
    r.power = best.power ?? r.power;
    matched++;
  }
  return matched;
}
