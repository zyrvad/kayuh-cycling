import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { endTour, tourBack, tourNext, tourRect, tourState } from "../tour.ts";
import "./tour.css";

const PAD = 8;
const EDGE = 12;
const GAP = 14;

export function TourLayer() {
  const st = tourState.value;
  const rect = tourRect.value;
  const tip = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [vp, setVp] = useState(0);

  // size of the popup is only known after render, so place it in a layout effect
  useLayoutEffect(() => {
    const node = tip.current;
    if (!node || !st) return;
    const w = window.innerWidth, h = window.innerHeight;
    const pcs = probe.current ? getComputedStyle(probe.current) : null;
    const top0 = EDGE + (pcs ? parseFloat(pcs.paddingTop) || 0 : 0), bot0 = h - EDGE - (pcs ? parseFloat(pcs.paddingBottom) || 0 : 0);
    const tw = node.offsetWidth, th = node.offsetHeight;
    if (!rect) {
      setPos({ top: Math.max(top0, (h - th) / 2), left: Math.max(EDGE, (w - tw) / 2) });
      return;
    }
    const holeTop = rect.y - PAD, holeBottom = rect.y + rect.h + PAD;
    let top: number;
    if (holeBottom + GAP + th <= bot0) top = holeBottom + GAP;
    else if (holeTop - GAP - th >= top0) top = holeTop - GAP - th;
    else top = Math.max(top0, bot0 - th); // no room either side: pin to the bottom edge
    const left = Math.max(EDGE, Math.min(rect.x, w - tw - EDGE));
    setPos({ top, left });
  }, [rect?.x, rect?.y, rect?.w, rect?.h, st?.i, vp]);

  useLayoutEffect(() => {
    if (!st) return;
    const on = () => setVp((v) => v + 1);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [!!st]);

  useLayoutEffect(() => { if (st) tip.current?.querySelector<HTMLElement>(".tour-next")?.focus({ preventScroll: true }); }, [st?.i]);

  if (!st) return null;
  const step = st.steps[st.i];
  const last = st.i === st.steps.length - 1;
  return (
    <>
      <div class="tour-veil" />
      <div ref={probe} class="tour-probe" aria-hidden="true" />
      {rect && (
        <div class="tour-hole" style={{
          transform: `translate(${rect.x - PAD}px, ${rect.y - PAD}px)`,
          width: `${rect.w + PAD * 2}px`, height: `${rect.h + PAD * 2}px`,
        }} />
      )}
      <div ref={tip} class="tour-tip" role="dialog" aria-live="polite" aria-label="App tour"
        style={pos ? { top: `${pos.top}px`, left: `${pos.left}px` } : { top: "0px", left: "0px", visibility: "hidden" }}>
        <h4>{step.title}</h4>
        <p>{step.text}</p>
        <div class="tour-row">
          <span class="tour-count">{st.i + 1} of {st.steps.length}</span>
          <span class="tour-btns">
            <button type="button" class="tour-skip" onClick={() => endTour()}>Skip</button>
            {st.i > 0 && <button type="button" class="tour-back" onClick={tourBack}>Back</button>}
            <button type="button" class="tour-next" onClick={tourNext}>{last ? "Done" : "Next"}</button>
          </span>
        </div>
      </div>
    </>
  );
}
