'use client';

import { useEffect, useLayoutEffect } from 'react';
import { startAnalytics } from '@/lib/analytics';
import { recordEvent } from '@/lib/storage';
import { startSync } from '@/lib/sync';
import { deviceContext } from '@/pack/runner';

// One app_open per page LOAD (not per React re-mount in dev strict mode).
let openRecorded = false;

/**
 * Kicks off the cloud-sync engine once, on the client, for the whole app.
 * No-ops when sync isn't configured. Renders nothing. Also the home of the
 * app-level analytics events: one app_open per load, and pwa_install when
 * the browser reports an Add-to-Home-Screen.
 *
 * The funnel beacon (src/lib/analytics.ts) subscribes from a LAYOUT
 * effect: React runs every layout effect in the tree before any passive
 * effect, so the subscription is live before a page's own effects fire —
 * the layout renders this component AFTER the page subtree, and
 * UpgradeCard records `upsell_seen` from a passive effect on a direct
 * Home/Settings load, which a passive subscription here would miss
 * (tests/analytics-setting.test.tsx). app_open is then recorded from the
 * passive effect, so it is the first thing the subscriber sees.
 */
export function SyncBootstrap() {
  useLayoutEffect(() => {
    startAnalytics();
  }, []);
  useEffect(() => {
    startSync();
    if (!openRecorded) {
      openRecorded = true;
      recordEvent('app_open', { ...deviceContext() });
    }
    const onInstalled = () => recordEvent('pwa_install');
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);
  return null;
}
