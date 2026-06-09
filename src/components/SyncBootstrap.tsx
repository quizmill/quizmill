'use client';

import { useEffect } from 'react';
import { startSync } from '@/lib/sync';

/**
 * Kicks off the cloud-sync engine once, on the client, for the whole app.
 * No-ops when sync isn't configured. Renders nothing.
 */
export function SyncBootstrap() {
  useEffect(() => {
    startSync();
  }, []);
  return null;
}
