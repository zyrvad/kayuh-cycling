import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hasPosition, mergeSensors, parseActivity, parseFit, parseGpx, parseTcx, positioned } from "../src/importers.ts";
import { decodeTrack, encodeTrack, type Sample } from "../src/track.ts";

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const T0 = Date.parse("2026-11-01T07:00:00Z");

test("GPX: positions, elevation, time and sensors in any extension prefix", () => {
  const a = parseGpx(fixture("ride.gpx"));
  assert.equal(a.startMs, T0);
  assert.equal(a.name, "Morning & coast");
  assert.equal(a.samples.length, 3, "the point with no time is skipped");
  assert.deepEqual(a.samples.map((s) => s.t), [0, 5, 10]);
  assert.deepEqual(a.samples[0].ll, [103.8, 1.3]);
  assert.deepEqual(a.samples[1].ll, [103.801, 1.3], "lon before lat, single quotes");
  assert.deepEqual(a.samples.map((s) => s.alt), [10, 11, null]);
  assert.deepEqual(a.samples.map((s) => s.hr), [120, 130, null]);
  assert.deepEqual(a.samples.map((s) => s.cad), [80, null, null]);
  assert.deepEqual(a.samples.map((s) => s.power), [150, 200, null]);
});

test("TCX: trackpoints, heart rate, cadence, watts; points without position kept for sensors", () => {
  const a = parseTcx(fixture("ride.tcx"));
  assert.equal(a.startMs, T0);
  assert.deepEqual(a.samples.map((s) => s.t), [0, 4, 8]);
  assert.deepEqual(a.samples.map((s) => s.hr), [110, 115, 118]);
  assert.deepEqual(a.samples.map((s) => s.cad), [70, null, null]);
  assert.deepEqual(a.samples.map((s) => s.power), [180, null, null]);
  assert.equal(a.samples[0].alt, 10);
  assert.deepEqual(a.samples.map(hasPosition), [true, true, false]);
  assert.equal(positioned(a.samples).length, 2);
  assert.equal(parseActivity(fixture("ride.tcx")).samples.length, 3, "format detected from the text");
});

test("parseActivity refuses other files", () => {
  assert.throws(() => parseActivity("<html></html>"), /Not a GPX/);
  assert.throws(() => parseActivity(new Uint8Array(40).buffer), /Not a GPX/);
});

// ---- a minimal FIT encoder: just enough to build test files
type Field = [num: number, size: number, type: number];
class Fit {
  private b: number[] = [];
  constructor(private le = true) {}
  private u(n: number, size: number) {
    const bytes = Array.from({ length: size }, (_, i) => (n >>> (8 * i)) & 0xff);
    this.b.push(...(this.le ? bytes : bytes.reverse()));
  }
  /** Definition message; `dev` adds developer fields of those sizes. */
  define(local: number, global: number, fields: Field[], dev: number[] = []) {
    this.b.push(0x40 | (dev.length ? 0x20 : 0) | local, 0, this.le ? 0 : 1);
    this.u(global, 2);
    this.b.push(fields.length);
    for (const [n, s, t] of fields) this.b.push(n, s, t);
    if (dev.length) { this.b.push(dev.length); dev.forEach((s, i) => this.b.push(i, s, 0x0d)); }
    return this;
  }
  /** Data message: values are written with each field's declared size (little or big endian as set). */
  data(local: number, fields: Field[], values: number[], devBytes = 0, header = local) {
    this.b.push(header);
    fields.forEach(([, s], i) => this.u(values[i] >>> 0, s));
    for (let i = 0; i < devBytes; i++) this.b.push(0xaa);
    return this;
  }
  bytes(): ArrayBuffer {
    const body = this.b, head = [14, 0x20, 0, 0, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0];
    // The header's data size is little endian whatever the messages' endianness.
    const size = body.length;
    head[4] = size & 0xff; head[5] = (size >> 8) & 0xff; head[6] = (size >> 16) & 0xff; head[7] = (size >> 24) & 0xff;
    return new Uint8Array([...head, ...body, 0, 0]).buffer;
  }
}
const FIT_T0 = (T0 - 631_065_600_000) / 1000;
const deg = (d: number) => Math.round(d / (180 / 2 ** 31));
const RECORD: Field[] = [[253, 4, 0x86], [0, 4, 0x85], [1, 4, 0x85], [2, 2, 0x84], [3, 1, 0x02], [4, 1, 0x02], [6, 2, 0x84], [7, 2, 0x84]];
const alt = (m: number) => Math.round((m + 500) * 5);

for (const le of [true, false]) {
  test(`FIT (${le ? "little" : "big"} endian): records, scaling, invalid values, developer fields`, () => {
    const f = new Fit(le)
      .define(0, 21, [[253, 4, 0x86], [0, 1, 0x00]]).data(0, [[253, 4, 0x86], [0, 1, 0x00]], [FIT_T0, 1]) // an event message: skipped
      .define(1, 20, RECORD, [3])
      .data(1, RECORD, [FIT_T0, deg(1.3), deg(103.8), alt(10), 120, 80, 5000, 150], 3)
      .data(1, RECORD, [FIT_T0 + 5, deg(1.3), deg(103.801), 0xffff, 0xff, 0xff, 0xffff, 0xffff], 3)
      .data(1, RECORD, [FIT_T0 + 9, 0x7fffffff, 0x7fffffff, alt(12), 130, 0, 7000, 0], 3);
    const a = parseFit(f.bytes());
    assert.equal(a.startMs, T0);
    assert.deepEqual(a.samples.map((s) => s.t), [0, 5, 9]);
    assert.ok(Math.abs(a.samples[0].ll[0] - 103.8) < 1e-6 && Math.abs(a.samples[0].ll[1] - 1.3) < 1e-6);
    assert.deepEqual(a.samples.map((s) => s.alt), [10, null, 12]);
    assert.deepEqual(a.samples.map((s) => s.hr), [120, null, 130]);
    assert.deepEqual(a.samples.map((s) => s.cad), [80, null, null], "cadence 0 is no signal");
    assert.deepEqual(a.samples.map((s) => s.power), [150, null, 0], "0 W is a real reading");
    assert.deepEqual(a.samples.map((s) => s.kmh), [18, null, 25.2]);
    assert.deepEqual(a.samples.map(hasPosition), [true, true, false], "invalid position becomes no position");
    assert.equal(parseActivity(f.bytes()).samples.length, 3, "format detected from the bytes");
  });
}

test("FIT: compressed timestamp headers and enhanced altitude/speed", () => {
  const BASE = Math.floor(FIT_T0 / 32) * 32 + 30; // low 5 bits = 30
  const withTs: Field[] = [[253, 4, 0x86], [78, 4, 0x86], [73, 4, 0x86], [3, 1, 0x02]];
  const noTs: Field[] = [[78, 4, 0x86], [73, 4, 0x86], [3, 1, 0x02]];
  const f = new Fit()
    .define(0, 20, withTs).data(0, withTs, [BASE, alt(20), 4000, 100])
    .define(2, 20, noTs)
    // offset 31 (+1 s from a 30 s timestamp, low 5 bits = 30), then 2 (wraps past 32: +4 s -> 36), compressed local type 2
    .data(2, noTs, [alt(21), 4000, 101], 0, 0x80 | (2 << 5) | 31)
    .data(2, noTs, [alt(22), 8000, 102], 0, 0x80 | (2 << 5) | 2);
  const a = parseFit(f.bytes());
  assert.deepEqual(a.samples.map((s) => s.t), [0, 1, 4]);
  assert.deepEqual(a.samples.map((s) => s.hr), [100, 101, 102]);
  assert.deepEqual(a.samples.map((s) => s.alt), [20, 21, 22]);
  assert.deepEqual(a.samples.map((s) => s.kmh), [14.4, 14.4, 28.8]);
});

test("imported samples encode to a v2 track that decodes back", () => {
  const a = parseGpx(fixture("ride.gpx"));
  const tj = encodeTrack(a.samples)!;
  assert.equal(tj.v, 2);
  assert.deepEqual(tj.h, [120, 130, null]);
  const back = decodeTrack(JSON.parse(JSON.stringify(tj)));
  assert.deepEqual(back.map((s) => [s.hr, s.cad, s.power]), a.samples.map((s) => [s.hr, s.cad, s.power]));
  const plain = encodeTrack(a.samples.map((s) => ({ ...s, hr: null, cad: null, power: null })))!;
  assert.equal(plain.v, 1, "no sensors, plain v1");
  assert.equal("h" in plain, false);
});

const sample = (t: number, over: Partial<Sample> = {}): Sample => ({ ll: [103.8, 1.3], t, alt: null, kmh: null, tier: -1, hr: null, cad: null, power: null, ...over });

test("mergeSensors matches by absolute time within 5 s", () => {
  // The ride started 3 s after the watch: ride t=0 is watch t=3.
  const ride = [0, 10, 20, 60].map((t) => sample(t));
  const watch = { startMs: T0, samples: [0, 1, 2, 3, 4, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24].map((t, i) => sample(t, { hr: 100 + i, power: i === 5 ? 250 : null })) };
  const n = mergeSensors(ride, T0 + 3000, watch);
  // ride 0 -> abs 3 s: watch t=3 (hr 103); ride 10 -> abs 13 s: nearest is t=14 (1 s away, hr 105);
  // ride 20 -> abs 23 s: t=23 (hr 114); ride 60 -> abs 63 s: nothing within 5 s.
  assert.equal(n, 3);
  assert.deepEqual(ride.map((s) => s.hr), [103, 105, 114, null]);
  assert.equal(ride[1].power, 250);
  assert.equal(ride[0].power, null);
  assert.equal(mergeSensors([sample(0)], T0, { startMs: T0, samples: [sample(0)] }), 0, "no sensor readings in the file");
});

const gpxOf = (pts: { time: string; hr?: number }[]) =>
  `<gpx><trk><trkseg>${pts.map((p, i) => `<trkpt lat="1.3" lon="${103.8 + i * 0.0001}"><time>${p.time}</time>${p.hr !== undefined ? `<extensions><hr>${p.hr}</hr></extensions>` : ""}</trkpt>`).join("")}</trkseg></trk></gpx>`;

test("import: heart rate outside 25-250 bpm is dropped (a spike can't block saving)", () => {
  const a = parseGpx(gpxOf([{ time: "2026-11-01T07:00:00Z", hr: 120 }, { time: "2026-11-01T07:00:01Z", hr: 2999 }, { time: "2026-11-01T07:00:02Z", hr: 10 }, { time: "2026-11-01T07:00:03Z", hr: 250 }]));
  assert.deepEqual(a.samples.map((s) => s.hr), [120, null, null, 250]);
});

test("import: a file spanning more than 48 h is refused with a friendly message", () => {
  assert.throws(() => parseGpx(gpxOf([{ time: "2026-11-01T07:00:00Z" }, { time: "2026-11-04T07:00:00Z" }])), /48 hours/);
  assert.doesNotThrow(() => parseGpx(gpxOf([{ time: "2026-11-01T07:00:00Z" }, { time: "2026-11-03T06:00:00Z" }])));
});

test("FIT: damage mid-file keeps the records already read; nothing readable still errors", () => {
  const rec = (ts: number) => [0x00, ...le32(ts), ...le32(Math.round(1.3 / (180 / 2 ** 31))), ...le32(Math.round((103.8 + ts * 1e-4) / (180 / 2 ** 31))), 120];
  const le32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const def = [0x40, 0, 0, 20, 0, 4, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 3, 1, 2].slice(0, 0).concat([0x40, 0, 0, 20, 0, 4, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 3, 1, 2]);
  const build = (body: number[]) => {
    const hdr = [12, 0x10, 0, 0, ...le32(body.length), 0x2e, 0x46, 0x49, 0x54];
    return new Uint8Array([...hdr, ...body, 0, 0]).buffer;
  };
  // Two good records, then a data message for an undefined local type (previously threw away everything).
  const good = build([...def, ...rec(1_000_000_000), ...rec(1_000_000_005), 0x03, 1, 2, 3]);
  assert.equal(parseFit(good).samples.length, 2);
  assert.throws(() => parseFit(build([0x03, 1, 2, 3])));
});
