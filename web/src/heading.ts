/** Which way the phone is pointing, from the compass, for heading-up navigation. */

let permission: Promise<boolean> | null = null;

/**
 * iOS only shows the compass to pages after a permission prompt, which must start from a tap.
 * Call this from the tap that starts a ride; elsewhere it resolves straight away.
 */
export function requestCompass(): Promise<boolean> {
  const DOE = (window as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (!DOE) return Promise.resolve(false);
  if (!DOE.requestPermission) return Promise.resolve(true);
  return (permission ??= DOE.requestPermission().then((s) => s === "granted").catch(() => false));
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
