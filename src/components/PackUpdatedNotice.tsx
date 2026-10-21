'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import {
  PACK_UPDATED_EVENT,
  peekPackUpdatedNotices,
  takePackUpdatedNotices,
  writePackUpdatedNotices,
  type PackUpdatedNotice as Notice,
} from '@/lib/packUpdates';

const NONE: Notice[] = [];

function reloadPage(): void {
  window.location.reload();
}

/**
 * Collect the stashed lines. A line for the ACTIVE pack means the page is
 * showing content that storage no longer holds (the pack is bound once
 * per load) — reload first, keeping the lines for the render after, and
 * show nothing now. Otherwise take the lines (they show once).
 */
function collect(reload: () => void): Notice[] {
  const pending = peekPackUpdatedNotices();
  if (pending.length === 0) return NONE;
  if (pending.some((n) => n.reload)) {
    writePackUpdatedNotices(pending.map((n) => ({ ...n, reload: false })));
    reload();
    return NONE;
  }
  return takePackUpdatedNotices();
}

/**
 * The one-line "Updated: now N questions" Home shows once after an
 * unlocked pack's daily check (src/lib/packUpdates.ts) fetched a newer
 * bundle — one line per updated pack. Nothing stashed → renders nothing.
 *
 * The slot is read on EVERY mount (not once per page load): Home comes
 * and goes with client-side navigation, and a check that finishes while
 * the learner is in a runner has nobody listening — the next Home must
 * find the line, and must do the active pack's reload. Reading in an
 * effect keeps the server render and the hydration pass identical
 * (no sessionStorage there), and the take clears the slot, so dev strict
 * mode's second effect run finds nothing and changes nothing. The check
 * may also finish while Home is up, so the slot is re-read on
 * PACK_UPDATED_EVENT.
 */
export function PackUpdatedNotice({ reload = reloadPage }: { reload?: () => void }) {
  const [notices, setNotices] = useState<Notice[]>(NONE);
  const [dismissed, setDismissed] = useState<string[]>([]);
  // Once a reload was asked for, the page is on its way out: ignore
  // anything the slot says after that (it holds the lines for the next
  // render, which must not be taken by this one).
  const reloading = useRef(false);

  useEffect(() => {
    const absorb = () => {
      if (reloading.current) return;
      const more = collect(() => {
        reloading.current = true;
        reload();
      });
      // Later lines replace an earlier one for the same pack.
      if (more.length > 0) {
        setNotices((prev) => [...prev.filter((p) => !more.some((m) => m.id === p.id)), ...more]);
      }
    };
    absorb();
    window.addEventListener(PACK_UPDATED_EVENT, absorb);
    return () => window.removeEventListener(PACK_UPDATED_EVENT, absorb);
  }, [reload]);

  const shown = notices.filter((n) => !dismissed.includes(n.id));
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="pack-updated-notices">
      {shown.map((n) => (
        <div
          key={n.id}
          data-testid="pack-updated-notice"
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-brand-500/30 bg-brand-50 p-4 text-sm text-brand-800 shadow-xs"
        >
          <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              Updated: now {n.count} question{n.count === 1 ? '' : 's'}
            </p>
            <p className="mt-0.5 text-brand-700">“{n.title}” has new questions.</p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed((d) => [...d, n.id])}
            aria-label="Dismiss"
            className="tap-feedback -m-1 rounded-full p-1 text-brand-700 hover:bg-brand-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
