import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import "./sheet.css";

export type Detent = "collapsed" | "half" | "full";
const LABEL: Record<Detent, string> = { collapsed: "closed", half: "half open", full: "fully open" };
const FLICK = 0.45; // px per ms

export interface SheetProps {
  class: string;
  /** Visible height (px) at the collapsed detent. */
  peek: number;
  /** Omit for the classic two-state sheet (collapsed at `peek` / open at natural height). */
  detents?: Detent[];
  initial?: Detent;
  onDetent?: (d: Detent) => void;
  /** Always-visible first row below the handle; part of the drag zone (detent mode only). */
  summary?: ComponentChildren;
  children: ComponentChildren;
}

export function Sheet(p: SheetProps) {
  return p.detents ? <DetentSheet {...p} detents={p.detents} /> : <ClassicSheet {...p} />;
}

/** The original two-state sheet: collapsed at `peek` or open at its natural height. */
function ClassicSheet({ class: cls, peek, children }: SheetProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [dy, setDy] = useState<number | null>(null);

  const onDown = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    let last = 0;
    const move = (ev: PointerEvent) => {
      last = ev.clientY - startY;
      setDy(last);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDy(null);
      if (Math.abs(last) < 6) setCollapsed((c) => !c); // a tap toggles
      else if (last > 50) setCollapsed(true);
      else if (last < -50) setCollapsed(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const drag = dy ?? 0;
  const transform = collapsed
    ? `translateY(calc(100% - ${peek}px + ${Math.min(0, drag)}px))`
    : `translateY(${Math.max(0, drag)}px)`;
  return (
    <div class={`${cls}${collapsed ? " collapsed" : ""}`} style={{ transform, transition: dy === null ? "transform 220ms ease" : "none" }}>
      <button class="sheet-grip" aria-label={collapsed ? "Expand panel" : "Collapse panel"} aria-expanded={!collapsed}
        onPointerDown={onDown} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCollapsed(!collapsed); } }}>
        <span class="handle" />
      </button>
      {children}
    </div>
  );
}

function DetentSheet({ class: cls, peek, detents, initial, onDetent, summary, children }: SheetProps & { detents: Detent[] }) {
  const el = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [detent, setDetent] = useState<Detent>(initial && detents.includes(initial) ? initial : detents[0]);
  const cur = useRef(detent);
  const pos = useRef<Record<string, number>>({});
  const dragging = useRef(false);
  const cb = useRef(onDetent);
  cb.current = onDetent;

  /** Where (translateY px) each detent sits. */
  const measure = () => {
    const sh = el.current, bd = body.current, ct = content.current;
    if (!sh || !bd || !ct) return;
    const H = sh.offsetHeight;
    const natural = sh.clientHeight - bd.clientHeight + ct.offsetHeight;
    const half = Math.max(peek + 40, Math.min(window.innerHeight * 0.45, natural));
    pos.current = { full: 0, half: Math.max(0, H - Math.min(H, half)), collapsed: Math.max(0, H - peek) };
  };
  /** Detents that sit at distinct heights, in the order given. */
  const usable = () => detents.filter((d, i, a) => a.findIndex((o) => Math.abs(pos.current[o] - pos.current[d]) < 8) === i);
  const place = (d: Detent, animate: boolean) => {
    const sh = el.current;
    if (!sh || pos.current[d] === undefined) return;
    sh.classList.toggle("no-anim", !animate || matchMedia("(prefers-reduced-motion: reduce)").matches);
    sh.style.transform = `translateY(${pos.current[d]}px)`;
  };
  const go = (d: Detent) => {
    cur.current = d;
    setDetent(d);
    place(d, true);
    cb.current?.(d);
  };

  useLayoutEffect(() => {
    measure();
    place(cur.current, false);
    el.current?.getBoundingClientRect(); // commit the position before animations are allowed
    el.current?.classList.add("ready");
  }, []);
  useEffect(() => {
    if (!el.current || !content.current) return;
    const ro = new ResizeObserver(() => {
      if (dragging.current) return;
      measure();
      place(cur.current, true);
    });
    ro.observe(el.current);
    ro.observe(content.current);
    return () => ro.disconnect();
  }, []);

  // One drag controller shared by the handle zone (pointer events) and the body (touch).
  const drag = useRef<{ y0: number; pos0: number; from: Detent; t: number; samples: { y: number; t: number }[] } | null>(null);
  const begin = (y: number) => {
    measure();
    dragging.current = true;
    el.current?.classList.add("no-anim");
    drag.current = { y0: y, pos0: pos.current[cur.current], from: cur.current, t: performance.now(), samples: [{ y, t: performance.now() }] };
  };
  const move = (y: number) => {
    const d = drag.current;
    if (!d) return;
    const now = performance.now();
    d.samples.push({ y, t: now });
    while (d.samples.length > 2 && now - d.samples[0].t > 100) d.samples.shift();
    const next = Math.min(pos.current.collapsed, Math.max(0, d.pos0 + (y - d.y0)));
    if (el.current) el.current.style.transform = `translateY(${next}px)`;
  };
  const end = (cancel = false) => {
    const d = drag.current;
    drag.current = null;
    dragging.current = false;
    if (!d) return;
    const s = d.samples, a = s[0], b = s[s.length - 1];
    const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
    const moved = Math.abs(b.y - d.y0);
    const list = usable();
    const live = (el.current ? new DOMMatrixReadOnly(getComputedStyle(el.current).transform).m42 : pos.current[d.from]);
    let target: Detent;
    if (cancel) target = d.from;
    else if (Math.abs(v) > FLICK && moved > 4) {
      const i = Math.max(0, list.indexOf(d.from));
      target = list[Math.min(list.length - 1, Math.max(0, i + (v > 0 ? -1 : 1)))];
      if (v > 0 && i === 0) target = list[0];
    } else target = list.reduce((best, k) => (Math.abs(pos.current[k] - live) < Math.abs(pos.current[best] - live) ? k : best), list[0]);
    go(target);
  };

  const cycle = () => {
    measure();
    const list = usable();
    go(list[(Math.max(0, list.indexOf(cur.current)) + 1) % list.length]);
  };

  // Handle zone: pointer events, follows the finger or mouse 1:1.
  const onHeadDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("a, input, select, textarea, button:not(.sheet-grip)")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const head = e.currentTarget as HTMLElement;
    head.setPointerCapture(e.pointerId);
    begin(e.clientY);
    let moved = false;
    const mv = (ev: PointerEvent) => { if (Math.abs(ev.clientY - e.clientY) > 4) moved = true; move(ev.clientY); };
    const up = (ev: PointerEvent) => {
      head.removeEventListener("pointermove", mv);
      head.removeEventListener("pointerup", up);
      head.removeEventListener("pointercancel", up);
      if (ev.type === "pointercancel") return end(true);
      if (!moved) { drag.current = null; dragging.current = false; cycle(); } else end();
    };
    head.addEventListener("pointermove", mv);
    head.addEventListener("pointerup", up);
    head.addEventListener("pointercancel", up);
  };

  // Body: touch only. Below full, a vertical drag moves the sheet; at full, only a pull down from scrollTop 0 does.
  useEffect(() => {
    const bd = body.current;
    if (!bd) return;
    let sx = 0, sy = 0, mode: "idle" | "pending" | "sheet" | "scroll" = "idle";
    const ts = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; mode = "pending"; };
    const tm = (e: TouchEvent) => {
      if (mode === "idle" || mode === "scroll") return;
      const t = e.touches[0];
      if (mode === "pending") {
        const dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        const atTop = bd.scrollTop <= 0;
        const sheetMoves = Math.abs(dy) > Math.abs(dx) && (cur.current !== "full" ? true : dy > 0 && atTop);
        if (!sheetMoves) { mode = "scroll"; return; }
        mode = "sheet";
        begin(sy);
      }
      if (e.cancelable) e.preventDefault();
      move(t.clientY);
    };
    const te = () => { if (mode === "sheet") end(); mode = "idle"; };
    bd.addEventListener("touchstart", ts, { passive: true });
    bd.addEventListener("touchmove", tm, { passive: false });
    bd.addEventListener("touchend", te);
    bd.addEventListener("touchcancel", te);
    return () => {
      bd.removeEventListener("touchstart", ts);
      bd.removeEventListener("touchmove", tm);
      bd.removeEventListener("touchend", te);
      bd.removeEventListener("touchcancel", te);
    };
  }, []);

  return (
    <div ref={el} class={`${cls} sheet-d is-${detent}`} data-detent={detent}>
      <div class="sheet-head" onPointerDown={onHeadDown}>
        <button class="sheet-grip" type="button" aria-label={`Panel: ${LABEL[detent]}`} aria-expanded={detent !== "collapsed"}
          onClick={(e) => { if (e.detail === 0) cycle(); }}>
          <span class="handle" />
        </button>
        {summary && <div class="sheet-summary">{summary}</div>}
      </div>
      <div ref={body} class="sheet-body">
        <div ref={content} class="sheet-content">{children}</div>
      </div>
    </div>
  );
}
