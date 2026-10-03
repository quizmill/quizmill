'use client';

import Link from 'next/link';
import { Cloud, CloudOff, Smartphone } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSyncStatus } from '@/lib/useStorage';
import { useSyncIdentity, type SyncIdentity } from '@/lib/useSyncIdentity';

/** "Leo" / "sync key QM-H3KDA…" / "ada@example.com", name in bold. */
function Who({ identity }: { identity: Extract<SyncIdentity, { kind: 'linked' }> }) {
  return (
    <>
      {identity.via === 'key' ? 'sync key ' : null}
      <strong className="font-semibold">{identity.label}</strong>
    </>
  );
}

/**
 * Says where answers entered on this device end up — the marking screen
 * is usually reached by scanning a QR with whichever phone is to hand,
 * and that phone may not be linked to the learner's sync key (or to any).
 *
 * `before`: shown above the marking rows, so a wrong / missing key is
 * noticed before anything is typed in. `after`: shown on the saved
 * screen, following the live sync state until the rows have gone up.
 */
export function SaveDestination({ phase }: { phase: 'before' | 'after' }) {
  const identity = useSyncIdentity();
  const sync = useSyncStatus();
  if (!identity) return null;

  const linked = identity.kind === 'linked';
  const unlinked = identity.kind === 'unlinked';
  const Icon = linked ? Cloud : unlinked ? CloudOff : Smartphone;

  let body: React.ReactNode;
  if (identity.kind === 'linked') {
    const who = <Who identity={identity} />;
    if (phase === 'before') {
      body = (
        <>
          Saving to {who} — answers sync to every device{' '}
          {identity.via === 'account' ? 'signed in to it' : 'linked to this key'}.
        </>
      );
    } else if (sync.state === 'synced') {
      body = <>Synced to {who} — it&apos;s on every linked device.</>;
    } else if (sync.state === 'offline') {
      body = (
        <>
          Saved on this device — it will sync to {who} when you&apos;re back
          online.
        </>
      );
    } else if (sync.state === 'error') {
      body = (
        <>
          Saved on this device — the sync server couldn&apos;t be reached yet,
          so it will retry for {who}.
        </>
      );
    } else {
      body = <>Syncing to {who}…</>;
    }
  } else if (identity.kind === 'unlinked') {
    body = (
      <>
        {phase === 'before' ? (
          <>
            <strong className="font-semibold">This device is not linked</strong>{' '}
            to a sync key. Answers you save stay on this device only — they
            won&apos;t show up on the learner&apos;s own device.
          </>
        ) : (
          <>
            <strong className="font-semibold">Saved on this device only</strong>{' '}
            — it is not linked to a sync key. Link it and these answers go
            up with everything else here.
          </>
        )}{' '}
        <Link
          href="/settings/#sync"
          className="font-semibold underline underline-offset-2"
        >
          Link this device
        </Link>
      </>
    );
  } else {
    body =
      phase === 'before' ? (
        <>
          Answers are saved on <strong className="font-semibold">this device</strong>{' '}
          — mark the sheet on the one the learner practises on.
        </>
      ) : (
        <>
          Saved on <strong className="font-semibold">this device</strong>.
        </>
      );
  }

  return (
    <p
      data-testid="save-destination"
      data-destination={identity.kind}
      className={cn(
        'flex items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm',
        unlinked
          ? 'border-warn-500/40 bg-warn-50 text-warn-700'
          : linked
            ? 'border-brand-500/30 bg-brand-50 text-ink-700'
            : 'border-ink-200 bg-surface text-ink-600',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 flex-shrink-0',
          unlinked ? 'text-warn-600' : linked ? 'text-brand-600' : 'text-ink-400',
        )}
      />
      <span className="min-w-0">{body}</span>
    </p>
  );
}
