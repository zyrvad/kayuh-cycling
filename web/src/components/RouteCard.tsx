import type { LonLat } from "@kayuh/router";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { snapshot } from "../mapSnapshot.ts";
import { decodePolyline, encodePolyline } from "../util.ts";
import { TierBar } from "./common.tsx";
import { MiniMap } from "./Rides.tsx";
import "./route-card.css";

export interface RouteCardProps {
  /** The line, as coordinates or an encoded polyline (one of the two). */
  coords?: LonLat[];
  polyline?: string;
  title: string;
  meta?: ComponentChildren;
  tierM?: number[];
  onOpen?: () => void;
  /** Action row under the body (buttons here don't open the card). */
  actions?: ComponentChildren;
  /** Content above the map, e.g. who rode it. */
  header?: ComponentChildren;
  /** Map width / height, default 16 / 9. */
  aspect?: number;
}

export function RouteCard({ coords, polyline, title, meta, tierM, onOpen, actions, header, aspect = 16 / 9 }: RouteCardProps) {
  const line = useMemo(() => coords ?? (polyline ? decodePolyline(polyline) : []), [coords, polyline]);
  const key = polyline ?? (coords ? `${coords.length}:${coords[0]}:${coords[coords.length - 1]}` : "");
  const poly = useMemo(() => polyline ?? "", [polyline]);
  const root = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || line.length < 2) return;
    let live = true;
    setShown(false);
    snapshot(line).then((u) => { if (live) setImg(u); });
    return () => { live = false; };
  }, [near, key]);

  const open = onOpen ? (
    <button type="button" class="rc-open" onClick={onOpen} aria-label={`Open ${title}`}>{inner()}</button>
  ) : <div class="rc-open">{inner()}</div>;

  function inner() {
    return (
      <>
        {header && <div class="rc-header">{header}</div>}
        <div class={`rc-map${img && shown ? " has-img" : ""}`} style={{ aspectRatio: String(aspect) }}>
          {poly ? <MiniMap polyline={poly} size={200} class="rc-mini" /> : <MiniMapCoords line={line} />}
          {img && <img src={img} alt="" class={shown ? "on" : ""} onLoad={() => setShown(true)} draggable={false} />}
          <span class="rc-attr">© OpenStreetMap</span>
        </div>
        <div class="rc-body">
          <div class="rc-title">{title}</div>
          {meta && <div class="rc-meta">{meta}</div>}
          {tierM && <TierBar tierM={tierM} height={6} />}
        </div>
      </>
    );
  }

  return (
    <article class="route-card" ref={root}>
      {open}
      {actions && <div class="rc-actions" onClick={(e) => e.stopPropagation()}>{actions}</div>}
    </article>
  );
}

/** MiniMap wants an encoded polyline; this is the coordinate-array equivalent. */
function MiniMapCoords({ line }: { line: LonLat[] }) {
  const p = useMemo(() => encodePolyline(line), [line]);
  return <MiniMap polyline={p} size={200} class="rc-mini" />;
}
