'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isStandaloneDisplay } from '@/lib/install';
import { APP_CONFIG } from '@/config';
import { hasInsertedPack } from '@/lib/packLibrary';
import {
  openUnlockedPack,
  unlockConfig,
  unlockPack,
  type UnlockFailure,
} from '@/lib/unlock';
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

/** Unlock failures worth asking again about on the next check. */
const RETRYABLE = new Set<UnlockFailure>(['offline', 'bad-response', 'cancelled']);

/** Some pack on this device is kept under exactly this licence key. */
function holdsLicenceKey(key: string): boolean {
  const ls = window.localStorage;
  for (let i = 0; i < ls.length; i++) {
    const name = ls.key(i);
    if (name?.startsWith('quizmill.') && name.endsWith('.licence') && ls.getItem(name) === key) {
      return true;
    }
  }
  return false;
}

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
  const pathname = usePathname();
  useEffect(() => {
    // The explicit browser unlock route owns its navigation, including after
    // it scrubs the URL key. Installed apps still collect claims as before.
    if (pathname?.replace(/\/$/, '') === '/unlock' && !isStandaloneDisplay()) return;
    const upgrade = APP_CONFIG.upgrade;
    if (!upgrade) return;
    const packId = APP_CONFIG.packId;
    const target = upgrade.packId;
    const deps: ClaimDeps = {
      fetchImpl: (...args) => fetch(...args),
      now: () => Date.now(),
      isUnlocked: (key) => {
        try {
          if (target) return hasInsertedPack(target);
          // No hint which pack the purchase is for: a pack already kept
          // under this very key is the one it would unlock.
          return key !== undefined && holdsLicenceKey(key);
        } catch {
          return false;
        }
      },
      unlock: async (key, signal) => {
        const outcome = await unlockPack(key, {
          config: unlockConfig(),
          buildPackId: buildTimeManifest.id,
          ...(signal ? { signal } : {}),
        });
        if (outcome.ok) {
          openUnlockedPack(outcome.entry);
          return 'ok';
        }
        // Unreachable, a 5xx/429 or an odd body: the service may be back
        // on the next check. A refused key or a wrong pack won't be.
        return RETRYABLE.has(outcome.reason) ? 'retry' : 'failed';
      },
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    let until = 0;
    let busy = false;
    let stopped = false;
    // The sweep that is out, so hiding the app can call it off.
    let sweep: AbortController | undefined;

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
      const ctrl = new AbortController();
      sweep = ctrl;
      let result: Awaited<ReturnType<typeof checkClaims>>;
      try {
        result = await checkClaims(packId, deps, ctrl.signal);
      } catch {
        result = 'none';
      } finally {
        busy = false;
        if (sweep === ctrl) sweep = undefined;
      }
      if (stopped || result !== 'pending' || hidden()) return;
      stopTimer(); // a tap during the sweep may have queued one already
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
      else {
        stopTimer();
        sweep?.abort();
      }
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
      sweep?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      if (kick === onTap) kick = null;
    };
  }, [pathname]);
  return null;
}
