'use client';

import { useEffect } from 'react';
import { cachePackAssets } from '@/lib/packAssets';
import { getInsertedPack, migrateInsertedPacks } from '@/lib/packLibrary';
import { checkPackUpdates } from '@/lib/packUpdates';
import { buildTimeManifest } from '@/pack/source';

// One sweep per page LOAD (not per React re-mount in dev strict mode).
let swept = false;

/** Test seam — allow another sweep. */
export function resetPackUpdateCheckForTests(): void {
  swept = false;
}

/**
 * The app-open half of "unlocked packs update themselves": once per page
 * load, after mount, ask the unlock endpoint about every inserted pack
 * that holds a licence key and is due (src/lib/packUpdates.ts does the
 * asking, the throttling and the storing; PackUpdatedNotice on Home does
 * the telling). Runs the library's localStorage → IndexedDB migration
 * first. Renders nothing; safe to mount in the layout. Nothing
 * here can fail the page — an unreachable endpoint is silence.
 */
export function PackUpdateCheck() {
  useEffect(() => {
    if (swept) return;
    swept = true;
    // Packs an older build kept in localStorage move to IndexedDB first.
    void migrateInsertedPacks()
      .catch(() => undefined)
      .then(() => checkPackUpdates({ buildPackId: buildTimeManifest.id }))
      .then(async (outcomes) => {
        // Prefetch any images a newer bundle points at — fire-and-forget,
        // as the unlock and the file insert do; the pack is already in.
        for (const [id, outcome] of Object.entries(outcomes)) {
          if (outcome !== 'updated') continue;
          const stored = await getInsertedPack(id);
          if (stored) void cachePackAssets(stored).catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, []);
  return null;
}
