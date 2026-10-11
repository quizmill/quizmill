'use client';

import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { takeUnlockedToast, type UnlockedToast as Toast } from '@/lib/unlock';
import { useClientState } from '@/lib/useMounted';

// Taken from sessionStorage once per page load and remembered here: the
// take clears the slot, and React re-invokes client reads in dev strict
// mode, so a second read would otherwise lose the message.
let taken: Toast | null | undefined;
function takeOnce(): Toast | null {
  if (taken === undefined) taken = takeUnlockedToast();
  return taken;
}

/** Test seam — forget the remembered toast so each test starts clean. */
export function resetUnlockedToastForTests(): void {
  taken = undefined;
}

/**
 * The one-time confirmation after a licence-key unlock. The unlock ends
 * in a full navigation to Home (so every module rebinds to the new pack),
 * which drops React state — the message rides in sessionStorage and is
 * read exactly once here. Nothing stashed → renders nothing.
 */
export function UnlockedToast() {
  // Read after mount: SSG renders with no sessionStorage.
  const [toast] = useClientState(takeOnce, null);
  const [dismissed, setDismissed] = useState(false);
  if (!toast || dismissed) return null;
  return (
    <div
      data-testid="unlocked-toast"
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-brand-500/30 bg-brand-50 p-4 text-sm text-brand-800 shadow-xs"
    >
      <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          Unlocked: {toast.count} question{toast.count === 1 ? '' : 's'}
        </p>
        <p className="mt-0.5 text-brand-700">“{toast.title}” is now your active pack.</p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="tap-feedback -m-1 rounded-full p-1 text-brand-700 hover:bg-brand-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
