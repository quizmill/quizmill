/**
 * Pulling an app update, rather than waiting for one to be pushed.
 *
 * The service worker is the unit of deployment: a new build ships as a
 * new sw.js (its cache key changes every commit — scripts/finalise-build.ts),
 * and the browser swaps it in once it notices. Noticing is the weak link.
 * A browser re-fetches sw.js on navigation, at most once a day; an
 * installed app seldom navigates, so a pushed update can sit unseen for
 * weeks. `checkForAppUpdate` is the learner's own "check now": it asks the
 * registration to re-fetch sw.js and reports what came of it, in terms the
 * Settings card can put into words. UpdateNotifier calls `update()` the
 * same way whenever the app returns to the foreground.
 */

export type AppUpdateResult =
  /** A newer build has installed; a reload picks it up. */
  | 'update-ready'
  /** sw.js came back byte-identical — this is the latest build. */
  | 'up-to-date'
  /** The re-fetch failed (no network) or the fresh worker failed to install. */
  | 'offline'
  /** No service worker here: an unsupported browser, a private window,
   *  or a dev server without one registered. */
  | 'unsupported';

type Container = Pick<ServiceWorkerContainer, 'getRegistration'>;

function browserContainer(): Container | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
}

/**
 * Ask the browser for a newer build. Resolves once the answer is known —
 * including the install of a freshly found worker, so 'update-ready' means
 * a reload will actually land on the new build (sw.js skips waiting and
 * claims the page, but the page's own chunks stay old until it reloads).
 */
export async function checkForAppUpdate(
  container: Container | undefined = browserContainer(),
): Promise<AppUpdateResult> {
  if (!container) return 'unsupported';
  let reg: ServiceWorkerRegistration | undefined;
  try {
    reg = await container.getRegistration();
  } catch {
    return 'unsupported';
  }
  if (!reg) return 'unsupported';
  // Already fetched and installed (a previous check, or the browser's own)
  // — no need to ask the server again.
  if (reg.waiting) return 'update-ready';
  try {
    await reg.update();
  } catch {
    return 'offline';
  }
  // `update()` resolves as soon as a changed script has STARTED installing
  // (`installing` is set by then); unchanged → neither slot is filled.
  const fresh = reg.installing ?? reg.waiting;
  if (!fresh) return 'up-to-date';
  return settled(fresh);
}

/** 'update-ready' once the worker leaves 'installing' for anything but
 *  'redundant' (an install that failed — treated as a network problem,
 *  which on a static host it almost always is). */
function settled(worker: ServiceWorker): Promise<AppUpdateResult> {
  return new Promise((resolve) => {
    const check = () => {
      if (worker.state === 'installing') return;
      worker.removeEventListener('statechange', check);
      resolve(worker.state === 'redundant' ? 'offline' : 'update-ready');
    };
    worker.addEventListener('statechange', check);
    check();
  });
}

/** Reload onto the new build. A seam so the Settings card can be
 *  exercised without navigating the test document. */
export function reloadApp(): void {
  window.location.reload();
}

/**
 * The stamped build timestamp (NEXT_PUBLIC_APP_BUILD_DATE, an ISO string)
 * as a short date — "21 Oct 2026". Locale pinned so the prerender and the
 * hydration pass agree whatever the device's locale; empty when unstamped
 * (a dev server) so nothing odd renders.
 */
export function formatBuildDate(iso: string | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
