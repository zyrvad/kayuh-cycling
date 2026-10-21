import { effect } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api.ts";
import { Discover } from "./components/Discover.tsx";
import { Plan } from "./components/Plan.tsx";
import { Ride } from "./components/Ride.tsx";
import { CrewTab, MeTab, openSaved, RidesTab, RoutesTab } from "./components/Tabs.tsx";
import { MapView } from "./map.ts";
import { router, routerReady } from "./routerClient.ts";
import {
  current, mode, myLocation, pickIndex, points, refreshPace, results, routerInfo, screen, selected, setPoint, sharedName, showToast, toast,
} from "./state.ts";

export function App() {
  const mapEl = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapView | null>(null);

  useEffect(() => {
    const m = new MapView(mapEl.current!);
    setMap(m);
    refreshPace();
    routerReady.then((info) => {
      routerInfo.value = info;
      router.pois().then((p) => m.setPois(p));
    });
    m.onTap = (ll) => {
      const i = pickIndex.value;
      if (i === null || screen.value !== "plan") return false;
      setPoint(i, { ll, label: "Dropped pin" });
      // In freeform, further taps keep extending the route.
      if (pickIndex.value === null && mode.value === "freeform") pickIndex.value = points.value.length;
      return true;
    };
    m.onDragPoint = (i, ll) => setPoint(i, { ll, label: points.value[i]?.label === "My location" ? "Near my location" : points.value[i]?.label ?? "Dropped pin" });

    // Map follows app state.
    const stops: (() => void)[] = [
      effect(() => { m.setRoutes(screen.value === "plan" || screen.value === "ride" ? results.value : [], selected.value); }),
      effect(() => {
        const show = screen.value === "plan";
        const pts = points.value;
        m.setPoints(show ? pts.map((p, i) => p && { ll: p.ll, kind: i === 0 ? "start" : i === pts.length - 1 && mode.value !== "loop" ? "end" : "via", label: p.label }) : []);
      }),
      effect(() => { m.setMe(myLocation.value); }),
      effect(() => {
        // Declutter: with a route on screen, only show parking you could actually use along it.
        const r = current.value;
        const routeShown = r && (screen.value === "plan" || screen.value === "ride");
        if (!routeShown) return void m.setParkingFocus(null);
        router.parkingNearRoute(r.coords).then((ids) => {
          if (current.value === r) m.setParkingFocus(ids);
        }).catch(() => m.setParkingFocus(null));
      }),
      effect(() => {
        const r = current.value;
        if (r && screen.value === "plan") m.fitRoute(r, { top: 170, bottom: Math.round(window.innerHeight * 0.55), left: 40, right: 40 });
      }),
    ];

    // Opened from a share link: /r/<token>
    const shared = location.pathname.match(/^\/r\/([A-Za-z0-9]+)$/);
    if (shared) {
      api.shared(shared[1]).then((r) => {
        openSaved({ ...r, id: "" });
        sharedName.value = r.name;
        history.replaceState(null, "", "/");
      }).catch((e) => showToast(e.message));
    }
    return () => stops.forEach((s) => s());
  }, []);

  const s = screen.value;
  return (
    <div class={`app screen-${s}`}>
      <div ref={mapEl} class="map" />
      {s === "discover" && <Discover map={map} />}
      {s === "plan" && <Plan />}
      {s === "ride" && current.value && <Ride map={map} />}
      {s === "routes" && <RoutesTab />}
      {s === "rides" && <RidesTab />}
      {s === "crew" && <CrewTab />}
      {s === "me" && <MeTab />}
      {toast.value && <div class="toast" role="status">{toast.value}</div>}
    </div>
  );
}
