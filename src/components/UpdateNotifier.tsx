'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Registers the service worker, then listens for it being replaced by a new
 * version. When a new SW finishes installing while the current page is
 * still controlled by the old one, we surface a banner inviting a reload
 * so the kid actually picks up the new app.
 *
 * The browser only re-fetches sw.js on a navigation, and at most once a
 * day; an installed app seldom navigates, so a pushed update could sit
 * unseen for weeks. Each return to the foreground therefore asks the
 * registration to check again (Settings has a button for the same —
 * src/lib/appUpdate.ts).
 *
 * Renders nothing when there's nothing to show — safe to mount near the
 * root of the layout.
 */
export function UpdateNotifier() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const url = `${BASE_PATH}/sw.js`;
    const scope = `${BASE_PATH}/`;
    let cancelled = false;
    let onVisible: (() => void) | undefined;

    navigator.serviceWorker
      .register(url, { scope })
      .then((reg) => {
        if (cancelled) return;

        // Back in the foreground — re-fetch sw.js. A find arrives through
        // 'updatefound' below like any other; a failure (offline) is silence.
        onVisible = () => {
          if (document.visibilityState !== 'visible') return;
          reg.update().catch(() => undefined);
        };
        document.addEventListener('visibilitychange', onVisible);

        // If there's already a worker waiting at registration time, that's
        // an update from a previous session — surface it immediately.
        if (reg.waiting && navigator.serviceWorker.controller) {
          setUpdateReady(true);
        }

        // Watch for new SWs that install during this session.
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // 'installed' + an existing controller means: a new SW is
            // ready, but the page is still being driven by the old one.
            // That's the moment to prompt the kid to reload.
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              setUpdateReady(true);
            }
          });
        });
      })
      .catch((err) => {
        // SW is a progressive enhancement — don't fail the page.
        console.warn('Service worker registration failed:', err);
      });

    return () => {
      cancelled = true;
      if (onVisible) document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!updateReady) return null;

  return (
    // On phones the tab bar (when showing — see TabBar's data-tab-bar flag)
    // owns the bottom edge, so the banner lifts above it; from sm: up the
    // bar is hidden and the banner keeps the bottom.
    <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-(--breakpoint-sm) px-4 pb-4 [html[data-tab-bar]_&]:bottom-14 sm:[html[data-tab-bar]_&]:bottom-0">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-brand-400 bg-brand-500 px-4 py-3 text-white shadow-lg">
        <div className="flex items-center gap-2 text-sm font-medium">
          <RefreshCw className="h-4 w-4" />
          A new version is ready.
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="tap-feedback rounded-full bg-surface px-4 py-1.5 text-sm font-semibold text-brand-700 shadow-xs hover:bg-brand-50"
        >
          Update
        </button>
      </div>
    </div>
  );
}
