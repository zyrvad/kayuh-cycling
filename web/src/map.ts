import type { LonLat, Poi, RouteResult } from "@kayuh/router";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { TIER_COLORS, TIER_LABELS } from "./util.ts";

// MapLibre 6 looks for its tile worker next to its own module, which bundling moves. Point it at the copy Vite ships.
maplibregl.setWorkerUrl(mapWorkerUrl);

const STYLE = "https://tiles.openfreemap.org/styles/positron";
const FONT = ["Noto Sans Bold"];
const INK = "#1D2A23";
/** Parking is clustered ("12 P" bubbles) until this zoom, then drawn spot by spot. */
const PARKING_CLUSTER_MAX_ZOOM = 16;
/** Route parking appears from this zoom. */
const PARKING_MINZOOM = 12;

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

/** A small traffic-light glyph (drawn at 2x for sharp screens). */
function trafficLightIcon(): ImageData {
  const w = 22, h = 44;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  x.fillStyle = "#FFFFFF";
  x.beginPath();
  x.roundRect(0, 0, w, h, 7);
  x.fill();
  x.fillStyle = "#1D2A23";
  x.beginPath();
  x.roundRect(2, 2, w - 4, h - 4, 5);
  x.fill();
  ["#E5484D", "#F2B33D", "#3DBE6E"].forEach((col, i) => {
    x.fillStyle = col;
    x.beginPath();
    x.arc(w / 2, 10 + i * 12, 4.2, 0, Math.PI * 2);
    x.fill();
  });
  return x.getImageData(0, 0, w, h);
}

export interface PointMarker {
  ll: LonLat;
  kind: "start" | "end" | "via";
  label?: string;
}

/** Thin wrapper around MapLibre with the layers Kayuh needs. */
export class MapView {
  readonly map: maplibregl.Map;
  private loaded: Promise<void>;
  private markers: maplibregl.Marker[] = [];
  /** Return true when the tap was used (e.g. to place a point), so the map does nothing else with it. */
  onTap: (ll: LonLat) => boolean | void = () => {};
  onDragPoint: (index: number, ll: LonLat) => void = () => {};

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: STYLE,
      // Start with the whole island visible above the search bar and the bottom sheet.
      bounds: [[103.6, 1.2], [104.05, 1.47]],
      fitBoundsOptions: { padding: { top: 140, bottom: Math.round(container.clientHeight * 0.45), left: 12, right: 12 } },
      minZoom: 9,
      // Extra room to the south so the island can be panned up above the bottom sheet.
      maxBounds: [[103.3, 0.75], [104.4, 1.65]],
      attributionControl: { compact: true, customAttribution: "Paths: OpenStreetMap, NParks, LTA, URA via data.gov.sg" },
      dragRotate: false,
      pitchWithRotate: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.loaded = new Promise((resolve) => this.map.on("load", () => {
      this.addLayers();
      // Keep the attribution as a small (i) button instead of a banner over the map.
      container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      resolve();
    }));
    this.map.on("click", (e) => {
      if (this.onTap([e.lngLat.lng, e.lngLat.lat])) return;
      const cluster = this.map.queryRenderedFeatures(e.point, { layers: ["parking-cluster"] })[0];
      if (cluster) {
        (this.map.getSource("parking") as GeoJSONSource).getClusterExpansionZoom(cluster.properties!.cluster_id)
          .then((zoom) => this.map.easeTo({ center: (cluster.geometry as GeoJSON.Point).coordinates as LonLat, zoom: zoom + 0.5 }));
        return;
      }
      const hit = this.map.queryRenderedFeatures(e.point, { layers: ["net-pcn", "net-cycleway", "net-shared", "net-footpath", "poi-parking"] })[0];
      if (hit && hit.layer.id === "poi-parking") this.parkingPopup(hit, e.lngLat);
      else if (hit) this.explainPopup(hit, e.lngLat);
    });
  }

  private firstSymbolLayer(): string | undefined {
    return this.map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  }

  private addLayers() {
    const m = this.map;
    const before = this.firstSymbolLayer();
    m.addSource("network", {
      type: "vector", tiles: [`${location.origin}/data/tiles/{z}/{x}/{y}.pbf`], minzoom: 9, maxzoom: 15,
      bounds: [103.6, 1.18, 104.05, 1.48],
    });
    const width = (w: number): maplibregl.ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], 9, w * 0.3, 13, w, 17, w * 2.4];
    const net = (id: string, t: number, color: string, w: number, extra: Partial<maplibregl.LineLayerSpecification> = {}) =>
      m.addLayer({
        id, type: "line", source: "network", "source-layer": "network", filter: ["==", ["get", "t"], t],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-width": width(w), "line-opacity": 0.9, ...(extra.paint ?? {}) },
        ...(extra.minzoom ? { minzoom: extra.minzoom } : {}),
      }, before);
    net("net-footpath", 3, TIER_COLORS[3], 1.1, { minzoom: 14, paint: { "line-dasharray": [1, 2] } as any });
    net("net-shared", 2, TIER_COLORS[2], 1.8, { paint: { "line-dasharray": [2, 1] } as any });
    net("net-cycleway", 1, TIER_COLORS[1], 1.8);
    net("net-pcn", 0, TIER_COLORS[0], 2.2);

    m.addSource("alts", { type: "geojson", data: empty() });
    m.addLayer({ id: "alts", type: "line", source: "alts", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#8D9891", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 7], "line-opacity": 0.55 } });
    m.addSource("route", { type: "geojson", data: empty() });
    m.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 13] } });
    m.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["match", ["get", "tier"], 0, TIER_COLORS[0], 1, TIER_COLORS[1], 2, TIER_COLORS[2], 3, TIER_COLORS[3], 4, TIER_COLORS[4], TIER_COLORS[5]],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 16, 8],
      } });
    m.addSource("done", { type: "geojson", data: empty() });
    m.addLayer({ id: "done", type: "line", source: "done", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#A7B0AA", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 16, 8] } });

    // Traffic lights you'll wait at on the selected route.
    m.addImage("traffic-light", trafficLightIcon(), { pixelRatio: 2 });
    m.addSource("lights", { type: "geojson", data: empty() });
    m.addLayer({ id: "k-lights", type: "symbol", source: "lights", minzoom: 11.5,
      layout: { "icon-image": "traffic-light", "icon-size": ["interpolate", ["linear"], ["zoom"], 11.5, 0.6, 16, 1], "icon-allow-overlap": true, "icon-anchor": "bottom", "icon-offset": [0, -4] } });

    m.addSource("pois", { type: "geojson", data: empty() });
    const amenity = (id: string, kind: string, color: string, letter: string) => {
      m.addLayer({ id, type: "circle", source: "pois", minzoom: 14.5, filter: ["==", ["get", "k"], kind],
        paint: { "circle-radius": 7, "circle-color": color, "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 1.5 } });
      m.addLayer({ id: `${id}-label`, type: "symbol", source: "pois", minzoom: 14.5, filter: ["==", ["get", "k"], kind],
        layout: { "text-field": letter, "text-font": FONT, "text-size": 9, "text-allow-overlap": true },
        paint: { "text-color": "#FFFFFF" } });
    };
    amenity("poi-water", "water", "#2E6BD1", "W");
    amenity("poi-toilet", "toilet", "#6B5BA8", "T");
    amenity("poi-hawker", "hawker", "#C25A16", "F");
    m.addLayer({ id: "poi-mrt", type: "symbol", source: "pois", minzoom: 12, filter: ["==", ["get", "k"], "mrt"],
      layout: { "text-field": ["coalesce", ["get", "n"], "MRT"], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.1] },
      paint: { "text-color": "#7A2E8E", "text-halo-color": "#FFFFFF", "text-halo-width": 1.5 } });
    // Legal parking has its own clustered source: 23k racks and yellow boxes are far too many to draw one by one.
    m.addSource("parking", { type: "geojson", data: empty(), cluster: true, clusterRadius: 44, clusterMaxZoom: PARKING_CLUSTER_MAX_ZOOM });
    const isCluster: maplibregl.FilterSpecification = ["has", "point_count"];
    m.addLayer({ id: "parking-cluster", type: "circle", source: "parking", minzoom: PARKING_MINZOOM, filter: isCluster,
      paint: {
        "circle-color": "#FFFFFF", "circle-stroke-color": INK, "circle-stroke-width": 1.5,
        "circle-radius": ["step", ["get", "point_count"], 11, 10, 13, 50, 16],
      } });
    m.addLayer({ id: "parking-cluster-count", type: "symbol", source: "parking", minzoom: PARKING_MINZOOM, filter: isCluster,
      layout: { "text-field": ["concat", ["get", "point_count_abbreviated"], " P"], "text-font": FONT, "text-size": 10, "text-allow-overlap": true },
      paint: { "text-color": INK } });
    m.addLayer({ id: "poi-parking", type: "circle", source: "parking", minzoom: PARKING_MINZOOM, filter: ["!", isCluster],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 5, 16, 8], "circle-color": INK, "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 1.5 } });
    m.addLayer({ id: "poi-parking-label", type: "symbol", source: "parking", minzoom: 14.5, filter: ["!", isCluster],
      layout: { "text-field": "P", "text-font": FONT, "text-size": 10, "text-allow-overlap": true }, paint: { "text-color": "#FFFFFF" } });

    m.addSource("stops", { type: "geojson", data: empty() });
    m.addLayer({ id: "stops", type: "circle", source: "stops",
      paint: { "circle-radius": 11, "circle-color": ["case", ["==", ["get", "last"], true], TIER_COLORS[0], INK], "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2 } });
    m.addLayer({ id: "stops-label", type: "symbol", source: "stops",
      layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": "#FFFFFF" } });

    m.addSource("me", { type: "geojson", data: empty() });
    m.addLayer({ id: "me-halo", type: "circle", source: "me", paint: { "circle-radius": 18, "circle-color": "#2E6BD1", "circle-opacity": 0.16 } });
    m.addLayer({ id: "me", type: "circle", source: "me", paint: { "circle-radius": 7, "circle-color": "#2E6BD1", "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 3 } });

    for (const id of ["net-pcn", "net-cycleway", "net-shared", "net-footpath", "poi-parking", "parking-cluster"]) {
      m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
    }
  }

  private explainPopup(f: maplibregl.MapGeoJSONFeature, at: maplibregl.LngLat) {
    const p = f.properties as { t: number; n?: string; r?: string; lit?: number; sh?: number };
    const el = document.createElement("div");
    el.className = "popup";
    const title = document.createElement("strong");
    title.textContent = p.n || TIER_LABELS[p.t];
    const tier = document.createElement("div");
    tier.textContent = p.n ? TIER_LABELS[p.t] : "";
    const why = document.createElement("div");
    why.className = "popup-why";
    why.textContent = `Why: ${p.r ?? "OSM tags"}${p.lit ? " · lit" : ""}${p.sh ? " · sheltered" : ""}`;
    el.append(title, tier, why);
    new maplibregl.Popup({ closeButton: false, maxWidth: "260px" }).setLngLat(at).setDOMContent(el).addTo(this.map);
  }

  private parkingPopup(f: maplibregl.MapGeoJSONFeature, at: maplibregl.LngLat) {
    const p = f.properties as { s: string; c: number; n?: string; t?: string; lots?: number };
    const el = document.createElement("div");
    el.className = "popup";
    const title = document.createElement("strong");
    title.textContent = p.n || (p.s === "lta" ? "LTA bike rack" : "Bike parking");
    const sub = document.createElement("div");
    sub.textContent = [p.t && !(p.n ?? "").startsWith(p.t) ? p.t : "", p.lots ? `${p.lots} lots` : "", p.c ? "sheltered" : "",
      p.s === "lta" ? "LTA" : "OpenStreetMap"].filter(Boolean).join(" · ");
    el.append(title, sub);
    new maplibregl.Popup({ closeButton: false }).setLngLat(at).setDOMContent(el).addTo(this.map);
  }

  private parking: GeoJSON.Feature[] = [];

  async setPois(pois: Poi[]) {
    await this.loaded;
    const feature = (p: Poi, i: number): GeoJSON.Feature => ({
      type: "Feature", properties: { id: i, k: p.k, n: p.n, s: p.s, c: p.c, t: p.t, lots: p.lots },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    });
    const all = pois.map(feature);
    this.parking = all.filter((f) => f.properties!.k === "parking");
    (this.map.getSource("pois") as GeoJSONSource).setData({ type: "FeatureCollection", features: all.filter((f) => f.properties!.k !== "parking") });
    this.applyParking();
  }

  private focus: number[] | null = null;

  /**
   * Which parking to draw: only spots within reach of the route you're on (ids from the router).
   * With no route (null) the map shows no parking at all.
   */
  async setParkingFocus(ids: number[] | null) {
    // Record the request before awaiting, and draw whatever is latest once loaded, so a slower
    // earlier call can't overwrite a newer one.
    this.focus = ids;
    await this.loaded;
    this.applyParking();
  }

  private applyParking() {
    const keep = new Set(this.focus ?? []);
    (this.map.getSource("parking") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: this.parking.filter((f) => keep.has(f.properties!.id)),
    });
  }

  async setRoutes(routes: RouteResult[], selected: number) {
    await this.loaded;
    const alts = routes.filter((_, i) => i !== selected).map((r) => ({
      type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: r.coords },
    }));
    (this.map.getSource("alts") as GeoJSONSource).setData({ type: "FeatureCollection", features: alts });
    const r = routes[selected];
    const segs = r ? r.segments.map((s) => ({
      type: "Feature" as const, properties: { tier: s.tier },
      geometry: { type: "LineString" as const, coordinates: r.coords.slice(s.from, s.to + 1) },
    })) : [];
    (this.map.getSource("route") as GeoJSONSource).setData({ type: "FeatureCollection", features: segs });
    const stops = r ? r.legs.map((leg, i) => ({
      type: "Feature" as const,
      properties: { label: i === r.legs.length - 1 ? "" : String(i + 1), last: i === r.legs.length - 1 },
      geometry: { type: "Point" as const, coordinates: [leg.to.lon, leg.to.lat] },
    })) : [];
    (this.map.getSource("stops") as GeoJSONSource).setData({ type: "FeatureCollection", features: stops });
    (this.map.getSource("lights") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (r?.lights ?? []).map((ll) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: ll } })),
    });
  }

  async setDone(coords: LonLat[]) {
    await this.loaded;
    (this.map.getSource("done") as GeoJSONSource).setData(coords.length > 1
      ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } } : empty());
  }

  async setMe(ll: LonLat | null) {
    await this.loaded;
    (this.map.getSource("me") as GeoJSONSource).setData(ll
      ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: ll } } : empty());
  }

  /** User-placed points as draggable markers. */
  setPoints(points: (PointMarker | null)[]) {
    for (const m of this.markers) m.remove();
    this.markers = [];
    points.forEach((p, i) => {
      if (!p) return;
      const el = document.createElement("div");
      el.className = `pin pin-${p.kind}`;
      el.setAttribute("aria-label", p.label ?? p.kind);
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p.ll).addTo(this.map);
      marker.on("dragend", () => {
        const ll = marker.getLngLat();
        this.onDragPoint(i, [ll.lng, ll.lat]);
      });
      this.markers.push(marker);
    });
  }

  fitRoute(r: RouteResult, padding: maplibregl.PaddingOptions) {
    const b = new maplibregl.LngLatBounds();
    for (const c of r.coords) b.extend(c);
    this.map.fitBounds(b as LngLatBoundsLike, { padding, duration: 600, maxZoom: 16 });
  }

  follow(ll: LonLat, bearing?: number) {
    this.map.easeTo({ center: ll, zoom: Math.max(this.map.getZoom(), 16), bearing: bearing ?? 0, duration: 800 });
  }

  flyTo(ll: LonLat, zoom = 15) {
    this.map.flyTo({ center: ll, zoom, duration: 700 });
  }

  setPadding(p: maplibregl.PaddingOptions) {
    this.map.setPadding(p);
  }
}
