'use client';

import { useEffect } from 'react';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { APP_CONFIG } from '@/config';
import { recordEvent } from '@/lib/storage';
import { upgradeHref, type UpgradePlacement } from '@/lib/upgrade';

// upsell_seen once per page LOAD per placement — a re-render of Home is
// not a second impression (and dev strict mode double-mounts).
const seen = new Set<UpgradePlacement>();

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
 *
 * Records `upsell_seen` / `upsell_clicked` app events ({ placement }) —
 * the two funnel steps after practising (src/lib/analytics.ts).
 */
export function UpgradeCard({ placement }: { placement: UpgradePlacement }) {
  const upgrade = APP_CONFIG.upgrade;
  const present = Boolean(upgrade);
  useEffect(() => {
    if (!present || seen.has(placement)) return;
    seen.add(placement);
    recordEvent('upsell_seen', { placement });
  }, [present, placement]);
  if (!upgrade) return null;
  return (
    <a
      href={upgradeHref(upgrade.url, APP_CONFIG.packId, placement)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => recordEvent('upsell_clicked', { placement })}
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
