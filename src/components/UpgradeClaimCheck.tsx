'use client';

import { useEffect } from 'react';
import { APP_CONFIG } from '@/config';
import { insertedPackKey } from '@/lib/packKeys';
import { openUnlockedPack, unlockConfig, unlockPack } from '@/lib/unlock';
import {
  CLAIM_POLL_MS,
  CLAIM_WINDOW_MS,
  checkClaims,
  hasPendingClaims,
  type ClaimDeps,
} from '@/lib/upgradeClaim';
import { buildTimeManifest } from '@/pack/source';

// The mounted checker's "start a window now", for the upgrade card's tap.
let kick: (() => void) | null = null;

/** Start (or restart) a check window — the upgrade card calls this on tap,
 *  for a checkout layer that may never hide the app underneath. */
export function watchUpgradeClaims(): void {
  kick?.();
}

/**
 * The "coming back" half of the upgrade claim hand-off
 * (src/lib/upgradeClaim.ts). While the ACTIVE pack has a claim pending,
 * check it when the app starts and whenever it becomes visible again:
 * at once, then every 3 s for a minute; never while hidden. A paid key
 * goes through the ordinary licence-key unlock and ends where that does —
 * Home, with the unlocked toast. Renders nothing; safe in the layout.
 */
export function UpgradeClaimCheck() {
  useEffect(() => {
    const upgrade = APP_CONFIG.upgrade;
    if (!upgrade) return;
    const packId = APP_CONFIG.packId;
    const target = upgrade.packId;
    const deps: ClaimDeps = {
      fetchImpl: (...args) => fetch(...args),
      now: () => Date.now(),
      isUnlocked: () => {
        if (!target) return false;
        try {
          return window.localStorage.getItem(insertedPackKey(target)) !== null;
        } catch {
          return false;
        }
      },
      unlock: async (key) => {
        const outcome = await unlockPack(key, {
          config: unlockConfig(),
          buildPackId: buildTimeManifest.id,
        });
        if (outcome.ok) {
          openUnlockedPack(outcome.entry);
          return 'ok';
        }
        return outcome.reason === 'offline' ? 'retry' : 'failed';
      },
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    let until = 0;
    let busy = false;
    let stopped = false;

    const stopTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    // A function, not a value: the answer changes while a check is out.
    const hidden = () => document.visibilityState === 'hidden';
    const tick = async () => {
      timer = undefined;
      if (stopped || busy || hidden()) return;
      busy = true;
      let result: Awaited<ReturnType<typeof checkClaims>>;
      try {
        result = await checkClaims(packId, upgrade, deps);
      } catch {
        result = 'none';
      } finally {
        busy = false;
      }
      if (stopped || result !== 'pending' || hidden()) return;
      if (Date.now() + CLAIM_POLL_MS < until) timer = setTimeout(() => void tick(), CLAIM_POLL_MS);
    };
    const start = (delay = 0) => {
      if (!hasPendingClaims(packId)) return;
      until = Date.now() + CLAIM_WINDOW_MS;
      stopTimer();
      if (delay > 0) timer = setTimeout(() => void tick(), delay);
      else void tick();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stopTimer();
    };

    // A tap's first check waits one interval: the checkout has only just
    // been asked to open and hasn't seen the claim yet.
    const onTap = () => start(CLAIM_POLL_MS);
    kick = onTap;
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      stopped = true;
      stopTimer();
      document.removeEventListener('visibilitychange', onVisibility);
      if (kick === onTap) kick = null;
    };
  }, []);
  return null;
}
