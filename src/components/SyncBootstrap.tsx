'use client';

import { useEffect } from 'react';
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
 */
export function SyncBootstrap() {
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
