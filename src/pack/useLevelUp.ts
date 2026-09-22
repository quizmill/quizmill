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
 * Persist any level crossings the attempt history has earned, as opaque
 * `level-N` records (riding the achievements store, and therefore sync).
 * The records are the high-water mark that floors the displayed level
 * and keeps a crossing celebrated once, ever, across devices — so EVERY
 * attempt-producing or history-merging path must land here eventually:
 * the visual runners via `useLevelUp`, Drive Mode silently after each
 * answer, and imported/synced history via the ProgressCard effect the
 * next time Home renders.
 *
 * Recording is deliberately independent of the device's Levels & XP
 * pref — hiding the UI must not let the high-water mark fall behind.
 * Only the pack's opt-in gates it. Returns the newly reached level, or
 * null when nothing new was crossed.
 */
export function recordLevelCrossings(
  attempts: readonly Attempt[],
): XpLevel | null {
  if (!progressionEnabled) return null;
  const reached = levelForXp(totalXp(attempts), PACK_XP_LEVELS);
  const already = recordedLevel(loadAchievements().map((e) => e.id));
  if (reached.level <= already) return null;
  const fresh: string[] = [];
  for (let n = already + 1; n <= reached.level; n++) {
    fresh.push(`${LEVEL_ID_PREFIX}${n}`);
  }
  recordEarnedAchievements(fresh);
  return reached;
}

/**
 * Level-up detection for the visual runners — the XP sibling of
 * `useAchievementUnlock`. After each recorded attempt call
 * `checkNow(attempts)`: crossings are persisted via
 * {@link recordLevelCrossings}, and the level reached is surfaced for a
 * single celebration — a learner whose history already spans several
 * levels gets one "you're level 7!" moment, not a parade. The
 * celebration (not the recording) honours the device's Levels & XP
 * pref.
 */
export function useLevelUp(): {
  nextLevelUp: XpLevel | null;
  /** Returns the new level number when one was crossed, else 0. */
  checkNow: (attempts: readonly Attempt[]) => number;
  clearNextLevelUp: () => void;
} {
  const [pending, setPending] = useState<XpLevel | null>(null);

  const checkNow = useCallback((attempts: readonly Attempt[]): number => {
    const reached = recordLevelCrossings(attempts);
    if (!reached) return 0;
    if (loadProgressionShown()) setPending((p) => p ?? reached);
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
