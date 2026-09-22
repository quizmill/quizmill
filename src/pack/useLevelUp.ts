'use client';

import { useCallback, useState } from 'react';
import type { Attempt } from '@/data/types';
import { levelForXp, totalXp, type XpLevel } from '@/lib/xp';
import { loadAchievements, recordEarnedAchievements } from '@/lib/storage';
import { progressionEnabled, PACK_XP_LEVELS } from '@/pack/data';
import { loadProgressionShown } from '@/lib/progressionPref';

/** Storage ids for level crossings — opaque to the achievements store
 *  (and to the sync backends), interpreted only here. */
const LEVEL_ID_PREFIX = 'level-';

/** Highest level already credited in the earned-achievements records. */
export function recordedLevel(earnedIds: readonly string[]): number {
  let max = 1; // everyone starts at level 1; it's never recorded
  for (const id of earnedIds) {
    if (!id.startsWith(LEVEL_ID_PREFIX)) continue;
    const n = Number(id.slice(LEVEL_ID_PREFIX.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/**
 * Level-up detection for the runners — the XP sibling of
 * `useAchievementUnlock`. After each recorded attempt call
 * `checkNow(attempts)`: every newly crossed level is persisted as an
 * opaque `level-N` record (riding the achievements store, and therefore
 * sync), and the HIGHEST new one is surfaced for a single celebration —
 * a learner whose history already spans several levels gets one "you're
 * level 7!" moment, not a parade. The records double as a high-water
 * mark: a crossing celebrated on one device is never re-celebrated on
 * another.
 *
 * No-ops entirely unless the pack opts into progression and the device
 * hasn't hidden it (Settings → Levels & XP).
 */
export function useLevelUp(): {
  nextLevelUp: XpLevel | null;
  /** Returns the new level number when one was crossed, else 0. */
  checkNow: (attempts: readonly Attempt[]) => number;
  clearNextLevelUp: () => void;
} {
  const [pending, setPending] = useState<XpLevel | null>(null);

  const checkNow = useCallback((attempts: readonly Attempt[]): number => {
    if (!progressionEnabled || !loadProgressionShown()) return 0;
    const reached = levelForXp(totalXp(attempts), PACK_XP_LEVELS);
    const already = recordedLevel(loadAchievements().map((e) => e.id));
    if (reached.level <= already) return 0;
    const fresh: string[] = [];
    for (let n = already + 1; n <= reached.level; n++) {
      fresh.push(`${LEVEL_ID_PREFIX}${n}`);
    }
    recordEarnedAchievements(fresh);
    setPending((p) => p ?? reached);
    return reached.level;
  }, []);

  const clearNextLevelUp = useCallback(() => setPending(null), []);

  return { nextLevelUp: pending, checkNow, clearNextLevelUp };
}

/** The celebration copy for a crossed level. */
export function levelUpCelebration(l: XpLevel): {
  emoji: string;
  name: string;
  description: string;
} {
  const next = PACK_XP_LEVELS.find((x) => x.level === l.level + 1);
  return {
    emoji: l.emoji,
    name: `Level ${l.level} — ${l.name}`,
    description: next
      ? `Keep practising to become ${next.name}.`
      : 'Top of the ladder. The mill is yours!',
  };
}
