'use client';

import { useCallback, useState } from 'react';
import { ACHIEVEMENT_BY_ID, type Achievement } from '@/pack/achievements';
import type { Attempt, Session } from '@/data/types';
import { newlyEarnedAchievements } from './achievements-engine';
import { loadAchievements, recordEarnedAchievements } from '@/lib/storage';

/**
 * Helper for the runners: after recording each attempt (and after
 * ending a session), call `checkNow(sessions, attempts)`. If any new
 * achievement was unlocked it gets persisted AND surfaced via
 * `nextUnlock` — the runner renders a `<Celebration achievement={...} />`
 * for it and calls `clearNextUnlock()` when it's dismissed.
 *
 * If multiple unlock at once, they queue up and surface one at a time.
 */
export function useAchievementUnlock(): {
  nextUnlock: Achievement | null;
  /** Returns the number of achievements unlocked by this call. */
  checkNow: (sessions: readonly Session[], attempts: readonly Attempt[]) => number;
  clearNextUnlock: () => void;
} {
  const [queue, setQueue] = useState<Achievement[]>([]);

  const checkNow = useCallback(
    (sessions: readonly Session[], attempts: readonly Attempt[]): number => {
      // Snapshot what's currently persisted — re-read at call time so we
      // don't race with any other writer.
      const alreadyEarned = new Set(loadAchievements().map((e) => e.id));
      const fresh = newlyEarnedAchievements(sessions, attempts, alreadyEarned);
      if (fresh.length === 0) return 0;
      recordEarnedAchievements(fresh);
      setQueue((q) => [
        ...q,
        ...fresh
          .map((id) => ACHIEVEMENT_BY_ID.get(id))
          .filter((a): a is Achievement => a !== undefined),
      ]);
      return fresh.length;
    },
    [],
  );

  const clearNextUnlock = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  return {
    nextUnlock: queue[0] ?? null,
    checkNow,
    clearNextUnlock,
  };
}
