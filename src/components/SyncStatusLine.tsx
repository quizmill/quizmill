'use client';

import { Check, CloudOff, RefreshCw } from 'lucide-react';
import { syncBackendInfo } from '@/lib/syncBackend';

/** Muted one-liner naming the backend this build syncs to (kind + host) —
 *  so any deployed app answers "where does my data go?" at a glance.
 *  Shared footer of both sync-settings cards. */
export function SyncBackendFooter() {
  const info = syncBackendInfo();
  if (!info) return null;
  return (
    <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-400" data-testid="sync-backend">
      Backend: {info.label}
    </p>
  );
}

/** Live one-liner describing where cloud sync is right now: offline (with a
 *  count of work held locally), actively syncing, or fully caught up.
 *  Shared by both sync-settings cards (sync key + Supabase). */
export function SyncStatusLine({ state, pending }: { state: string; pending: number }) {
  if (state === 'offline') {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-ink-500">
        <CloudOff className="h-4 w-4" />
        {pending > 0
          ? `Offline — ${pending} ${pending === 1 ? 'change' : 'changes'} saved here, will sync when you're back online.`
          : 'Offline — changes are saved here and will sync when you reconnect.'}
      </p>
    );
  }
  if (state === 'syncing') {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-brand-700">
        <RefreshCw className="h-4 w-4 animate-spin" />
        {pending > 0 ? `Syncing ${pending}…` : 'Syncing…'}
      </p>
    );
  }
  if (state === 'synced') {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-brand-700">
        <Check className="h-4 w-4" />
        Up to date
      </p>
    );
  }
  return null;
}
