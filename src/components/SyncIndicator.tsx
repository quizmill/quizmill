'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, CloudOff, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '@/lib/useStorage';
import { cn } from '@/lib/cn';

/**
 * A very subtle, app-wide marker for cloud-sync state — so a learner who
 * did a stack of quizzes offline (on a plane, say) can tell at a glance
 * that their work is saved locally and, once back online, that it has
 * caught up.
 *
 * Only appears while signed in (sync active). The "Synced" tick is shown
 * just briefly, and only after an actual offline/syncing → caught-up
 * transition, so it never flashes on a normal page load. Offline and
 * syncing markers stay put until the state changes.
 *
 * Renders nothing when sync isn't configured or the user is signed out.
 */
export function SyncIndicator() {
  const status = useSyncStatus();
  const prevState = useRef(status.state);
  const [showSynced, setShowSynced] = useState(false);

  useEffect(() => {
    const prev = prevState.current;
    prevState.current = status.state;

    // Confirm "caught up" only when we land on 'synced' from a state where
    // there was actually something outstanding — not on first load.
    if (status.state === 'synced' && (prev === 'syncing' || prev === 'offline')) {
      setShowSynced(true);
      const t = setTimeout(() => setShowSynced(false), 2500);
      return () => clearTimeout(t);
    }
    if (status.state !== 'synced') setShowSynced(false);
  }, [status.state]);

  let content: { icon: React.ReactNode; label: string; tone: string } | null = null;

  if (status.state === 'offline') {
    content = {
      icon: <CloudOff className="h-3.5 w-3.5" />,
      label:
        status.pending > 0
          ? `Offline · ${status.pending} saved here`
          : 'Offline',
      tone: 'border-ink-200 bg-white/90 text-ink-500',
    };
  } else if (status.state === 'syncing') {
    content = {
      icon: <RefreshCw className="h-3.5 w-3.5 animate-spin" />,
      label: status.pending > 0 ? `Syncing ${status.pending}…` : 'Syncing…',
      tone: 'border-brand-200 bg-brand-50/90 text-brand-700',
    };
  } else if (status.state === 'synced' && showSynced) {
    content = {
      icon: <Check className="h-3.5 w-3.5" />,
      label: 'Synced',
      tone: 'border-brand-200 bg-brand-50/90 text-brand-700',
    };
  }

  if (!content) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-sm backdrop-blur',
          content.tone,
        )}
      >
        {content.icon}
        <span>{content.label}</span>
      </div>
    </div>
  );
}
