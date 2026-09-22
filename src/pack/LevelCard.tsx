'use client';

import { useEffect, useState } from 'react';
import type { Attempt } from '@/data/types';
import { levelProgress, totalXp } from '@/lib/xp';
import {
  PROGRESSION_EVENT,
  loadProgressionShown,
} from '@/lib/progressionPref';
import { progressionEnabled } from '@/pack/data';

/**
 * The Home level card — "Level 4 · Apprentice Miller" with the XP bar
 * to the next rung. Progress-bar-first by design: the meta-analyses put
 * visible progress toward an attainable criterion at the healthy end of
 * gamification, so the bar IS the feature and the XP number rides along
 * as small print. Renders nothing unless the pack opts into progression
 * (manifest `progression` block) and the device hasn't hidden it
 * (Settings → Levels & XP).
 */
export function LevelCard({ attempts }: { attempts: readonly Attempt[] }) {
  // Device pref read after mount so SSR/first paint stay stable; the
  // Settings toggle fires PROGRESSION_EVENT so an open Home updates.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const read = () => setShown(loadProgressionShown());
    read();
    window.addEventListener(PROGRESSION_EVENT, read);
    return () => window.removeEventListener(PROGRESSION_EVENT, read);
  }, []);

  if (!progressionEnabled || !shown) return null;

  const p = levelProgress(totalXp(attempts));
  return (
    <div
      data-testid="level-card"
      className="flex items-center gap-3 rounded-2xl border border-brand-500/30 bg-brand-50 p-4 shadow-sm"
    >
      <div
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-xl leading-none"
        aria-hidden
      >
        {p.level.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-base font-semibold text-ink-900">
            Level {p.level.level} · {p.level.name}
          </div>
          <span className="text-xs font-medium text-ink-500">{p.xp} XP</span>
        </div>
        {p.next ? (
          <>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface/70">
                <div
                  className="h-full bg-brand-500 transition-all"
                  style={{ width: `${p.pct}%` }}
                />
              </div>
            </div>
            <div className="mt-1 text-xs text-ink-500">
              {p.toNext} XP to {p.next.name}
            </div>
          </>
        ) : (
          <div className="mt-0.5 text-sm text-ink-600">
            Top of the ladder — the mill is yours.
          </div>
        )}
      </div>
    </div>
  );
}
