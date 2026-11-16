/** Which way the phone is pointing, from the compass, for heading-up navigation. */

import { signal } from "@preact/signals";

/** granted: compass events flow; needs-tap: iOS wants a tap to prompt; unavailable: no compass, or the rider said no. */
export type CompassState = "granted" | "needs-tap" | "unavailable";

type DOEWithPermission = { requestPermission?: () => Promise<string> };
const doe = () => (window as { DeviceOrientationEvent?: DOEWithPermission }).DeviceOrientationEvent;

export const compassState = signal<CompassState>(!doe() ? "unavailable" : doe()!.requestPermission ? "needs-tap" : "granted");

let pending: Promise<CompassState> | null = null;

/**
 * iOS only shows the compass to pages after a permission prompt, which must start from a tap. Called without a tap it
 * rejects: that is not remembered, so a later tap can still prompt. Only a pending request is shared.
 */
export function requestCompass(): Promise<CompassState> {
  const DOE = doe();
  if (!DOE) return Promise.resolve((compassState.value = "unavailable"));
  if (!DOE.requestPermission || compassState.value === "granted") return Promise.resolve((compassState.value = "granted"));
  return (pending ??= DOE.requestPermission()
    .then((s): CompassState => (s === "granted" ? "granted" : s === "denied" ? "unavailable" : "needs-tap"))
    .catch((): CompassState => "needs-tap")
    .then((st) => { pending = null; return (compassState.value = st); }));
}

/** Calls back with the compass heading (degrees clockwise from north). Returns a function to stop. */
export function watchCompass(cb: (deg: number) => void): () => void {
  const screenAngle = () => screen.orientation?.angle ?? 0;
  // iPhone: webkitCompassHeading is already a true-north-ish heading.
  const ios = (e: DeviceOrientationEvent) => {
    const h = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
    if (typeof h === "number" && !Number.isNaN(h)) cb((h + screenAngle()) % 360);
  };
  // Android: absolute orientation, alpha counter-clockwise from north.
  const abs = (e: DeviceOrientationEvent) => {
    if (e.absolute && e.alpha !== null) cb((360 - e.alpha + screenAngle()) % 360);
  };
  window.addEventListener("deviceorientation", ios);
  window.addEventListener("deviceorientationabsolute", abs as EventListener);
  return () => {
    window.removeEventListener("deviceorientation", ios);
    window.removeEventListener("deviceorientationabsolute", abs as EventListener);
  };
}

/** The signed difference b - a in degrees, the short way round (-180..180). */
export const angleDiff = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/** Move a towards b by fraction k, the short way round. */
export const blendAngle = (a: number, b: number, k: number) => (a + angleDiff(a, b) * k + 360) % 360;

/** Initial bearing from one point to another, degrees clockwise from north. */
export function bearing([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
