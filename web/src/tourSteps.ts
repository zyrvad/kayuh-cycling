import { mode, myLocation, points, results, screen, selected, groupCap, pickIndex } from "./state.ts";
import type { TourStep } from "./tour.ts";

export const TOUR_KEY = "kayuh.tourDone";

const FALLBACK: [number, number] = [103.8198, 1.3521];

/**
 * Targets are `[data-tour="id"]` attributes added to the screens. A step whose target is
 * missing is skipped, so this list can run ahead of the markup.
 */
export function tourSteps(): TourStep[] {
  const t = (id: string) => `[data-tour="${id}"]`;
  // True when the tour itself started the plan, so it can tidy up afterwards.
  let madePlan = false;
  const ensurePlan = () => {
    if (points.value.some(Boolean)) return;
    groupCap.value = null;
    mode.value = "loop";
    points.value = [{ ll: myLocation.value ?? FALLBACK, label: "My location" }];
    pickIndex.value = null;
    madePlan = true;
  };
  const tidy = (done: boolean) => {
    if (madePlan) {
      madePlan = false;
      mode.value = "ab";
      points.value = [null, null];
      results.value = [];
      selected.value = 0;
      if (screen.value === "plan") screen.value = "home";
    }
    if (done) screen.value = "home";
  };
  const steps: TourStep[] = [
    { sel: t("home-actions"), screen: "home", title: "Start here", text: "Plan a ride on the map, or record a free ride with no route." },
    { sel: t("map-search"), screen: "discover", title: "Search places", text: "Look up a park, a mall or a postal code, then use it as a start or stop." },
    { sel: t("map-legend"), screen: "discover", title: "Path colours", text: "Park connectors and cycling paths show in green. Roads are the last resort." },
    { sel: t("plan-stops"), screen: "plan", before: ensurePlan, title: "Your stops", text: "Start, stops and end sit here in order. Add stops or reverse the route." },
    { sel: t("plan-watch"), screen: "plan", title: "Send to watch", text: "Export a GPX file with parking and leg breaks for your Huawei or Amazfit watch." },
    { sel: t("ride-button"), screen: "plan", title: "Ride button", text: "Start ride gives turn by turn guidance and warns before your free minutes run out." },
    { sel: t("routes-list"), screen: "routes", title: "Saved routes", text: "Routes you save wait here. Open one to ride it again or share it." },
    { sel: t("rides-switch"), screen: "rides", title: "Activities and Training", text: "Switch between your past rides and your training load, effort and goals." },
    { sel: t("rides-import"), screen: "rides", title: "Import", text: "Bring in a GPX or FIT file from your watch or another app." },
    { sel: t("crew-feed"), screen: "crew", title: "Crew feed", text: "See rides your friends chose to share. Your own rides stay private by default." },
    { sel: t("crew-crews"), screen: "crew", title: "Crews", text: "Make a crew, share routes and plan group rides. The strictest rental limit wins." },
    { sel: t("profile-head"), screen: "me", title: "Profile", text: "Your stats, records and recent rides. Sign in to keep them on every device." },
    { sel: t("settings-link"), screen: "me", title: "Settings", text: "Change your bike, free minutes and units. You can replay this tour here." },
  ];
  steps[steps.length - 1].onEnd = tidy;
  steps[0].onEnd = (done) => { if (!done) tidy(false); };
  return steps;
}
