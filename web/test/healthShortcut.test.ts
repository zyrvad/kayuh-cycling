import assert from "node:assert/strict";
import { test } from "node:test";
import { hrActivity, mergeHr, parseHrText, shortcutUrl } from "../src/healthShortcut.ts";
import { analyse, type Sample } from "../src/track.ts";

const T0 = Date.parse("2026-11-01T07:00:00Z");
const sample = (t: number): Sample => ({ ll: [103.8 + t * 0.0001, 1.3], t, alt: null, kmh: 12, tier: 0, hr: null, cad: null, power: null });

test("parseHrText: ISO lines, bad lines skipped, sorted and de-duplicated", () => {
  const hr = parseHrText("2026-11-01T07:00:10+00:00,130\r\n2026-11-01T07:00:00Z,120\nnonsense\n2026-11-01T07:00:20Z,24\n2026-11-01T07:00:30Z,abc\n2026-11-01T07:00:00Z,121\n2026-11-01T15:00:40+08:00,140.4 count/min");
  assert.deepEqual(hr.map((h) => [h.t - T0, h.bpm]), [[0, 121], [10000, 130], [40000, 140]]);
});

test("parseHrText: Shortcuts' default date format (local time, 12 h clock)", () => {
  const local = (y: number, mo: number, d: number, h: number, mi: number, s: number) => new Date(y, mo, d, h, mi, s).getTime();
  const hr = parseHrText("21 Nov 2026 at 7:02:13 AM,123\n21 Nov 2026 at 7:02:13 PM,150\nNov 21, 2026 at 12:00 AM,60\n21 Nov 2026 at 12:30:00 PM,99");
  assert.deepEqual(hr.map((h) => h.t), [local(2026, 10, 21, 0, 0, 0), local(2026, 10, 21, 7, 2, 13), local(2026, 10, 21, 12, 30, 0), local(2026, 10, 21, 19, 2, 13)]);
  assert.deepEqual(hr.map((h) => h.bpm), [60, 123, 99, 150]);
});

test("shortcutUrl carries start, end and upload url as the shortcut's text input", () => {
  const u = shortcutUrl({ start: "2026-11-01T07:00:00.000Z", end: "2026-11-01T07:15:00.000Z", uploadUrl: "https://k.example/api/hr/abc" });
  assert.ok(u.startsWith("shortcuts://run-shortcut?name=Kayuh%20heart%20rate&input=text&text="));
  const text = decodeURIComponent(new URL(u).searchParams.get("text")!);
  assert.deepEqual(JSON.parse(text), { start: "2026-11-01T07:00:00.000Z", end: "2026-11-01T07:15:00.000Z", url: "https://k.example/api/hr/abc" });
});

test("sparse readings are held up to a minute so they line up with the ride", () => {
  const act = hrActivity([{ t: T0, bpm: 100 }, { t: T0 + 30_000, bpm: 110 }, { t: T0 + 300_000, bpm: 120 }]);
  const at = (s: number) => act.samples.find((x) => x.t === s)?.hr;
  assert.equal(at(29), 100);
  assert.equal(at(30), 110);
  assert.equal(at(89), 110);
  assert.equal(at(90), undefined, "held for 60 s, not across the gap");
  assert.equal(at(300), 120);
});

test("pasted readings merge onto a ride and feed the analysis", () => {
  const ride = Array.from({ length: 61 }, (_, i) => sample(i * 5));
  const hr = parseHrText(Array.from({ length: 31 }, (_, i) => `${new Date(T0 + i * 10_000).toISOString()},${110 + i}`).join("\n"));
  const n = mergeHr(ride, T0, hr);
  assert.equal(n, 61);
  assert.equal(ride[0].hr, 110);
  assert.equal(ride[60].hr, 140, "ride t=300 s is the last reading, 140");
  const a = analyse(ride, [0]);
  assert.ok(a.avgHr !== undefined && a.avgHr > 110 && a.avgHr < 140);
});

test("readings from another time of day match nothing", () => {
  const ride = [0, 5, 10].map(sample);
  assert.equal(mergeHr(ride, T0, parseHrText("2026-11-01T18:00:00Z,120\n2026-11-01T18:00:10Z,121")), 0);
  assert.equal(mergeHr(ride, T0, []), 0);
});
