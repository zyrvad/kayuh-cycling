/** Planned route to a GPX file for the watch (Huawei Health, Zepp): named waypoints for parking and leg breaks come from the router. */
import type { RouteResult } from "@kayuh/router";
import type { SavedRoute } from "./api.ts";
import { router } from "./routerClient.ts";
import { cap, showToast } from "./state.ts";

export async function sendToWatch(r: RouteResult, name: string) {
  const gpx = await router.gpx(r, name);
  const file = new File([gpx], `${name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "kayuh-route"}.gpx`, { type: "application/gpx+xml" });
  // On iPhone the share sheet can hand the file straight to Huawei Health or Zepp.
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  showToast("GPX downloaded: import it in Huawei Health (Me › My route) or Zepp");
}

/** A saved route stores its stops, not the full plan, so it's planned again (with its own preferences) and exported. */
export async function sendSavedToWatch(saved: Pick<SavedRoute, "name" | "points" | "prefs">) {
  const [route] = await router.plan({ points: saved.points, prefs: saved.prefs, capMinutes: cap.value });
  if (!route) throw new Error("Couldn't plan this route to export it");
  await sendToWatch(route, saved.name);
}
