/**
 * Heart rate from Apple Health through an iOS Shortcut. A home-screen web app can't read HealthKit, so the app
 * launches the "Kayuh heart rate" shortcut, which reads Health and either POSTs to the Worker or copies text to the clipboard.
 */
import type { ImportedActivity } from "./importers.ts";
import { mergeSensors } from "./importers.ts";
import type { Sample } from "./track.ts";

export const SHORTCUT_NAME = "Kayuh heart rate";
export interface HrSample { t: number; bpm: number }

/** The shortcuts:// link that runs the shortcut with {start, end, url} as its text input. */
export function shortcutUrl(info: { start: string; end: string; uploadUrl: string }): string {
  const text = JSON.stringify({ start: info.start, end: info.end, url: info.uploadUrl });
  return `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(text)}`;
}

/** Mint a token for the ride, then build the link. */
export async function buildShortcutUrl(ride: { id: string }): Promise<string> {
  const { api } = await import("./api.ts");
  return shortcutUrl(await api.hrToken(ride.id));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// "21 Nov 2026 at 7:02:13 AM" (Shortcuts' default; the space before AM may be a narrow no-break space) and "Nov 21, 2026 at 7:02 PM".
const DMY = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})(?:\s+at|,)?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/;
const MDY = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+at|,)?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/;

function parseTime(raw: string): number {
  const s = raw.replace(/[  ]/g, " ").trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return Date.parse(s);
  const m = DMY.exec(s) ?? MDY.exec(s);
  if (!m) return NaN;
  const dmy = DMY.test(s);
  const [day, mon] = dmy ? [m[1], m[2]] : [m[2], m[1]];
  const mi = MONTHS.indexOf(mon.toLowerCase());
  if (mi < 0) return NaN;
  let h = Number(m[4]);
  const ap = m[7]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  // No zone in these formats: the phone's own, which is where Health recorded them.
  return new Date(Number(m[3]), mi, Number(day), h, Number(m[5]), Number(m[6] ?? 0)).getTime();
}

/** "ISO time,bpm" lines (or Shortcuts' default date format) to readings in time order. Lines that don't parse are skipped. */
export function parseHrText(text: string): HrSample[] {
  const out = new Map<number, number>();
  for (const line of text.split(/\r?\n/)) {
    const i = line.lastIndexOf(",");
    if (i < 0) continue;
    const t = parseTime(line.slice(0, i));
    const bpm = parseFloat(line.slice(i + 1));
    if (Number.isFinite(t) && Number.isFinite(bpm) && bpm >= 25 && bpm <= 250) out.set(t, Math.round(bpm));
  }
  return [...out].sort((a, b) => a[0] - b[0]).map(([t, bpm]) => ({ t, bpm }));
}

/** Apple Health logs heart rate every few seconds to minutes. Hold each reading for up to this long so sparse data still lines up. */
export const HOLD_S = 60;

/** Readings as a 1 Hz activity (each held up to HOLD_S) that mergeSensors can match against ride samples. */
export function hrActivity(hr: HrSample[]): ImportedActivity {
  const startMs = Math.floor(hr[0].t / 1000) * 1000;
  const samples: Sample[] = [];
  const blank = { ll: [NaN, NaN] as [number, number], alt: null, kmh: null, tier: -1, cad: null, power: null };
  for (let i = 0; i < hr.length; i++) {
    const until = Math.min(i + 1 < hr.length ? hr[i + 1].t : Infinity, hr[i].t + HOLD_S * 1000);
    for (let t = hr[i].t; t < Math.max(until, hr[i].t + 1); t += 1000) {
      samples.push({ ...blank, t: Math.round((t - startMs) / 1000), hr: hr[i].bpm });
    }
  }
  return { startMs, samples };
}

/** Put readings onto the ride's samples (in place). Returns how many samples got one. */
export function mergeHr(rideSamples: Sample[], rideStartMs: number, hr: HrSample[]): number {
  if (!hr.length) return 0;
  return mergeSensors(rideSamples, rideStartMs, hrActivity(hr));
}
