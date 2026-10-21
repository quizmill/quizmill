'use client';

import Link from 'next/link';
import { ArrowRight, KeyRound, PackagePlus } from 'lucide-react';
import { APP_CONFIG } from '@/config';
import { LicenceKeyForm } from '@/components/LicenceKeyForm';
import { unlockConfig } from '@/lib/unlock';
import { isStarterPack } from '@/pack/starter';

/**
 * "Add a pack" — the first thing a fresh install of the home app says.
 * Rendered on Home only while the ACTIVE pack is the starter
 * (src/pack/starter.ts): one tap to the shelf (insert files or a URL,
 * browse the registry) and the licence-key entry inline — the same
 * `LicenceKeyForm` as /unlock and /packs, so a key typed here ends on the
 * unlocked pack's Home exactly like the link does. Any other active pack
 * renders nothing: a pack app never shows an empty-shelf pitch.
 */
export function StarterPackCard() {
  if (!isStarterPack(APP_CONFIG.packId)) return null;
  return (
    <section
      data-testid="starter-card"
      className="flex flex-col gap-3 rounded-2xl border border-brand-500/30 bg-brand-50 p-4 shadow-xs"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-brand-700">
          <PackagePlus className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-900">Add a pack</h2>
          <p className="mt-0.5 text-sm text-ink-600">
            This app practises whatever pack is active. The questions below
            are about the app itself — add a pack to practise something
            else.
          </p>
        </div>
      </div>

      <Link
        href="/packs"
        data-testid="starter-packs-link"
        className="tap-feedback flex items-center justify-between gap-3 rounded-xl bg-night-900 px-4 py-3 text-white"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Insert a pack or pick one from the registry</span>
          <span className="block text-xs text-night-300">
            A pack&apos;s files, a bundle, a GitHub repo, or a published pack
          </span>
        </span>
        <ArrowRight className="h-5 w-5 shrink-0 text-night-300" aria-hidden />
      </Link>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-800">
          <KeyRound className="h-4 w-4 text-ink-500" aria-hidden />
          Have a licence key?
        </p>
        <LicenceKeyForm config={unlockConfig()} />
      </div>
    </section>
  );
}
