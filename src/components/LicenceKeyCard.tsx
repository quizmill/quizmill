'use client';

import { KeyRound } from 'lucide-react';
import { LicenceKeyForm } from '@/components/LicenceKeyForm';
import { unlockConfig } from '@/lib/unlock';

/**
 * "Have a licence key?" on /packs — the typed-key twin of the /unlock
 * link, for a second device and for an installed PWA (whose storage the
 * link, opened in the browser, never reaches). Rendered in every build:
 * the key alone says which pack, so no pack has to declare anything for
 * a learner to unlock one here.
 */
export function LicenceKeyCard() {
  const config = unlockConfig();
  return (
    <section
      data-testid="licence-key-card"
      className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-xs"
    >
      <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
        <KeyRound className="h-5 w-5 text-ink-500" />
        Have a licence key?
      </h2>
      <p className="mt-1 text-sm text-ink-600">
        Enter a licence key to fetch the pack it unlocks and start practising it
        here.
      </p>
      <div className="mt-4">
        <LicenceKeyForm config={config} />
      </div>
    </section>
  );
}
