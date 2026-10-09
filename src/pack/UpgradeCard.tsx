'use client';

import { ArrowUpRight, Sparkles } from 'lucide-react';
import { APP_CONFIG } from '@/config';
import { upgradeHref, type UpgradePlacement } from '@/lib/upgrade';

/**
 * The pack's upgrade pitch — a free or sampler pack pointing at the paid
 * course / full bank it is a taste of. Driven entirely by the manifest's
 * optional `upgrade` block (title, url, price?, blurb?): no block, no card,
 * no layout change. The engine supplies the frame only; every word and the
 * destination are the pack's, so nothing here is specific to any shop.
 *
 * Rendered in two places, each stamped into the link's `ref` param so the
 * destination can tell them apart: Home (below the practice loop — the
 * pitch never sits above practising) and Settings (Packs section).
 */
export function UpgradeCard({ placement }: { placement: UpgradePlacement }) {
  const upgrade = APP_CONFIG.upgrade;
  if (!upgrade) return null;
  return (
    <a
      href={upgradeHref(upgrade.url, APP_CONFIG.packId, placement)}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={`upgrade-card-${placement}`}
      className="tap-feedback flex items-center justify-between gap-3 rounded-2xl border border-brand-500/30 bg-brand-50 p-4 shadow-sm transition hover:border-brand-500/50 hover:shadow-md"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-brand-700">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-ink-900">{upgrade.title}</span>
            {upgrade.price ? (
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">
                {upgrade.price}
              </span>
            ) : null}
          </div>
          {upgrade.blurb ? (
            <div className="mt-0.5 text-sm text-ink-600">{upgrade.blurb}</div>
          ) : null}
        </div>
      </div>
      <ArrowUpRight className="h-5 w-5 flex-shrink-0 text-brand-500" aria-hidden />
    </a>
  );
}
