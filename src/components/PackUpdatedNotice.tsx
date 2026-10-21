'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import {
  PACK_UPDATED_EVENT,
  peekPackUpdatedNotices,
  takePackUpdatedNotices,
  writePackUpdatedNotices,
  type PackUpdatedNotice as Notice,
} from '@/lib/packUpdates';
import { useClientState } from '@/lib/useMounted';

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

// Collected once per page load and remembered: the take clears the slot,
// and React re-invokes client reads in dev strict mode, so a second read
// would lose the lines (or reload twice).
let taken: Notice[] | undefined;
let takenWith: (() => void) | undefined;
function takeOnce(reload: () => void): Notice[] {
  if (taken === undefined || takenWith !== reload) {
    takenWith = reload;
    taken = collect(reload);
  }
  return taken;
}

/** Test seam — forget the remembered lines so each test starts clean. */
export function resetPackUpdatedNoticeForTests(): void {
  taken = undefined;
  takenWith = undefined;
}

/**
 * The one-line "Updated: now N questions" Home shows once after an
 * unlocked pack's daily check (src/lib/packUpdates.ts) fetched a newer
 * bundle — one line per updated pack. Nothing stashed → renders nothing.
 * The check may finish while Home is already up, so the slot is also
 * re-read on PACK_UPDATED_EVENT.
 */
export function PackUpdatedNotice({ reload = reloadPage }: { reload?: () => void }) {
  // Read after mount: SSG renders with no sessionStorage. The loader is
  // stable per `reload` (a module function by default).
  const load = useCallback(() => takeOnce(reload), [reload]);
  const [initial] = useClientState(load, NONE);
  const [later, setLater] = useState<Notice[]>(NONE);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    const onUpdated = () => {
      const more = collect(reload);
      if (more.length > 0) setLater((prev) => [...prev.filter((p) => !more.some((m) => m.id === p.id)), ...more]);
    };
    window.addEventListener(PACK_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(PACK_UPDATED_EVENT, onUpdated);
  }, [reload]);

  // Later lines replace an earlier one for the same pack.
  const notices = [...initial.filter((n) => !later.some((l) => l.id === n.id)), ...later].filter(
    (n) => !dismissed.includes(n.id),
  );
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="pack-updated-notices">
      {notices.map((n) => (
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
