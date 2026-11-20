import type { TourStep } from "./tour.ts";

export const TOUR_KEY = "kayuh.tourDone";

/**
 * Targets are `[data-tour="id"]` attributes added to the screens. A step whose target is
 * missing is skipped, so this list can run ahead of the markup.
 */
export function tourSteps(): TourStep[] {
  const t = (id: string) => `[data-tour="${id}"]`;
  return [
    // TODO: switch to screen "home" once that screen exists.
    { sel: t("home-actions"), title: "Start here", text: "Your quick actions live on the home screen: plan a ride, pick up a saved route or head out." },
    { sel: t("map-search"), screen: "discover", title: "Search places", text: "Look up a park, a mall or a postal code, then drop it on the map as a stop." },
    { sel: t("map-legend"), screen: "discover", title: "Path colours", text: "Park connectors and cycling paths show in green. Roads are the last resort." },
    { sel: t("plan-stops"), screen: "plan", title: "Add your stops", text: "Add stops in order and drag to reorder. Kayuh picks the best paths between them." },
    { sel: t("plan-watch"), screen: "plan", title: "Send to watch", text: "Export the route as a GPX file with parking and leg breaks for your watch." },
    { sel: t("routes-list"), screen: "routes", title: "Saved routes", text: "Routes you save wait here. Open one to ride it again or share it." },
    { sel: t("ride-button"), screen: "plan", title: "Ready to ride", text: "Tap Ride for turn by turn guidance. It warns you before your free minutes run out." },
    { sel: t("rides-switch"), screen: "rides", title: "Activities or Training", text: "Switch between your past rides and your training load, effort and goals." },
    { sel: t("rides-import"), screen: "rides", title: "Import a ride", text: "Bring in a GPX or FIT file from your watch or another app." },
    { sel: t("crew-feed"), screen: "crew", title: "Crew feed", text: "See rides your friends chose to share. Your own rides stay private by default." },
    { sel: t("crew-crews"), screen: "crew", title: "Your crews", text: "Make a crew, share routes and plan group rides. The strictest rental limit wins." },
    { sel: t("profile"), screen: "me", title: "Your profile", text: "Sign in to keep routes and rides on every device." },
    { sel: t("settings-link"), screen: "me", title: "Settings", text: "Change your bike, free minutes and units. You can replay this tour here." },
  ];
}
