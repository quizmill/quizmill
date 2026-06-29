'use client';

import { useEffect } from 'react';
import { APP_CONFIG } from '@/config';
import { useStorageData } from '@/lib/useStorage';
import { buildStreakMirror, refreshReminders } from '@/lib/reminders';

/**
 * Keeps the service-worker-visible streak mirror up to date. The SW can't read
 * localStorage, so whenever attempts change we recompute a tiny streak summary
 * and write it to IndexedDB (and, if the user opted in, re-assert periodic
 * sync). Renders nothing — safe to mount once near the root of the layout.
 */
export function ReminderSync() {
  const { attempts } = useStorageData();

  useEffect(() => {
    const mirror = buildStreakMirror(
      attempts,
      APP_CONFIG.packId,
      APP_CONFIG.title,
    );
    void refreshReminders(mirror);
  }, [attempts]);

  return null;
}
