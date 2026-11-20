import { effect } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api.ts";
import { Home } from "./components/Home.tsx";
import { Discover } from "./components/Discover.tsx";
import { Onboarding, showOnboarding } from "./components/Onboarding.tsx";
import { TourLayer } from "./components/Tour.tsx";
import { handleFollowLink } from "./components/Feed.tsx";
import { Plan } from "./components/Plan.tsx";
import { Ride } from "./components/Ride.tsx";
import { CrewTab } from "./components/Crew.tsx";
import { MeTab, openSaved, RoutesTab } from "./components/Tabs.tsx";
import { RidesTab } from "./components/Rides.tsx";
import { MapView } from "./map.ts";
import { loadActiveRide } from "./activeRide.ts";
import { updateAvailable, watchForUpdates } from "./update.ts";
import { router, routerReady } from "./routerClient.ts";
import {
  current, mapBearing, mode, rideDetail, myLocation, openCrew, openGroupRide, pickIndex, points, refreshMe, refreshPace, results, rideView, routerInfo, screen, selected,
  setPoint, sharedName, showToast, toast,
} from "./state.ts";

function hasActiveRide() {
  try { return localStorage.getItem("kayuh.activeRide") !== null; } catch { return false; }
}

export function App() {
  const mapEl = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapView | null>(null);

  useEffect(() => {
    const m = new MapView(mapEl.current!);
    setMap(m);
    // A ride left open (app closed, or reloaded to clear iPhone's typing history) picks up where it was.
    const active = loadActiveRide();
    if (active) {
      results.value = [active.route];
      selected.value = 0;
      screen.value = "ride";
    }
    watchForUpdates();
    refreshMe();
    // ?debug exposes internals for poking at from the browser console.
    if (new URLSearchParams(location.search).has("debug")) Object.assign(window, { kayuh: { map: m, router, current } });
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
    m.onBearing = (b) => (mapBearing.value = b);
    // Twisting the map by hand during a ride means "leave it like this".
    m.onUserRotate = () => { if (screen.value === "ride") rideView.value = "free"; };
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
        if (!r || screen.value !== "plan") return;
        // Keep the route clear of the stop list, however long it is.
        const head = document.querySelector(".plan-top")?.getBoundingClientRect().bottom ?? 170;
        m.fitRoute(r, { top: Math.round(head) + 24, bottom: Math.round(window.innerHeight * 0.55), left: 40, right: 40 });
      }),
    ];

    // Crew invite (/join/<code>) and group ride (/ride/<id>) links.
    const join = location.pathname.match(/^\/join\/([A-Za-z0-9]+)$/);
    if (join) {
      history.replaceState(null, "", "/");
      api.joinCrew(join[1]).then((j) => { showToast(`You joined ${j.name}`); openCrew(j.crewId); })
        .catch((e) => { showToast(e.status === 401 ? "Sign in first, then open the invite link again" : e.message); screen.value = "crew"; });
    }
    // Follow links (/follow/<code>) from a friend's Friends panel.
    handleFollowLink();
    const rideLink = location.pathname.match(/^\/ride\/([0-9a-f-]{36})$/);
    if (rideLink) {
      history.replaceState(null, "", "/");
      openGroupRide(rideLink[1]);
    }

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
    <div class={`app screen-${s}${s === "rides" && rideDetail.value ? " ride-detail" : ""}`}>
      <div ref={mapEl} class="map" />
      {s === "discover" && <Discover map={map} />}
      {s === "plan" && <Plan map={map} />}
      {s === "ride" && (current.value || loadActiveRide()) && <Ride map={map} />}
      {s === "routes" && <RoutesTab />}
      {s === "rides" && <RidesTab map={map} />}
      {s === "crew" && <CrewTab map={map} />}
      {s === "home" && <Home />}
      {(s === "me" || s === "settings") && <MeTab />}
      {showOnboarding.value && s !== "ride" && !hasActiveRide() && <Onboarding />}
      <TourLayer />
      {toast.value && <div class="toast" role="status">{toast.value}</div>}
      {updateAvailable.value && (
        <button class="update-banner" onClick={() => location.reload()}>
          A new version of Kayuh is ready · <strong>Reload</strong>
        </button>
      )}
    </div>
  );
}
