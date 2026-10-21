import { signal } from "@preact/signals";

/** True once the server has a newer build than the one this tab is running. */
export const updateAvailable = signal(false);

const BUNDLE = /\/assets\/index-[\w-]+\.js/;
const CHECK_EVERY_MS = 5 * 60 * 1000;

function runningBundle(): string | null {
  for (const s of Array.from(document.scripts)) {
    const m = s.src.match(BUNDLE);
    if (m) return m[0];
  }
  return null; // dev server: nothing to compare
}

async function check() {
  const mine = runningBundle();
  if (!mine || updateAvailable.value) return;
  try {
    const html = await fetch("/", { cache: "no-store" }).then((r) => r.text());
    const latest = html.match(BUNDLE)?.[0];
    if (latest && latest !== mine) updateAvailable.value = true;
  } catch { /* offline: try again later */ }
}

/** Check when the app comes back to the foreground, and every few minutes while open. */
export function watchForUpdates() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  setInterval(check, CHECK_EVERY_MS);
  check();
}
