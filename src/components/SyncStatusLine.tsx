'use client';

import type { ReactNode } from 'react';
import { Check, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { syncBackendInfo } from '@/lib/syncBackend';

/** Muted one-liner naming the backend this build syncs to (kind + host) —
 *  so any deployed app answers "where does my data go?" at a glance.
 *  Shared footer of every sync-settings card (rendered by SyncCard). */
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
 *  Shared by every sync-settings card. */
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

/**
 * The shell of a "Sync across devices" Settings card: cloud icon + heading,
 * a "Loading…" placeholder until the card knows its own state, the body,
 * then the status/error lines and the backend footer. The built-in key
 * card renders through it, and a custom backend registering its own card
 * (registerSyncSettingsCard in SyncSettings.tsx) should too, so every
 * backend's card looks the same and only the middle differs.
 */
export function SyncCard({
  connected,
  loading,
  status,
  error,
  children,
}: {
  /** Lights the cloud icon — a key is stored / someone is signed in. */
  connected: boolean;
  /** True until the card has read its state (the first client render). */
  loading: boolean;
  /** A one-line confirmation ("Linked!"), shown below the body. */
  status?: string | null;
  /** A one-line failure, shown below the status. */
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-xs"
      data-testid="sync-card"
      data-connected={connected ? 'true' : 'false'}
    >
      <div className="flex items-center gap-2">
        {connected ? (
          <Cloud className="h-5 w-5 text-brand-600" />
        ) : (
          <CloudOff className="h-5 w-5 text-ink-400" />
        )}
        <h3 className="text-lg font-semibold text-ink-900">Sync across devices</h3>
      </div>

      {loading ? <p className="mt-2 text-sm text-ink-500">Loading…</p> : children}

      {status && (
        <p
          className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800"
          data-testid="sync-card-status"
        >
          {status}
        </p>
      )}
      {error && (
        <p
          className="mt-3 rounded-lg bg-warn-100/60 px-3 py-2 text-sm text-warn-700"
          data-testid="sync-card-error"
        >
          {error}
        </p>
      )}
      <SyncBackendFooter />
    </div>
  );
}
