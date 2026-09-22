'use client';

import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import type { Attempt } from '@/data/types';
import { cn } from '@/lib/cn';
import { streakProgress } from '@/lib/stats';
import { levelProgress, totalXp } from '@/lib/xp';
import { loadAchievements } from '@/lib/storage';
import {
  PROGRESSION_EVENT,
  loadProgressionShown,
} from '@/lib/progressionPref';
import { progressionEnabled, PACK_XP_LEVELS } from '@/pack/data';
import { recordLevelCrossings, recordedLevel } from '@/pack/useLevelUp';

/**
 * The single "how am I doing" card on Home: the level row (for packs
 * that opt into progression) and the daily-streak row, folded into one
 * compact card so the top of the app stays calm — one border, slim
 * bars, no oversized icons. Either row hides independently: the level
 * row without the manifest `progression` block or when the device pref
 * hides it; the streak row until there's any streak signal at all.
 *
 * Progress-bar-first by design: the meta-analyses put visible progress
 * toward an attainable criterion at the healthy end of gamification,
 * so the bars ARE the feature and the numbers ride along as small
 * print.
 */
export function ProgressCard({ attempts }: { attempts: readonly Attempt[] }) {
  // Device pref read after mount so SSR/first paint stay stable; the
  // Settings toggle fires PROGRESSION_EVENT so an open Home updates.
  const [prefShown, setPrefShown] = useState(false);
  useEffect(() => {
    const read = () => setPrefShown(loadProgressionShown());
    read();
    window.addEventListener(PROGRESSION_EVENT, read);
    return () => window.removeEventListener(PROGRESSION_EVENT, read);
  }, []);

  // Catch-all for history that arrives OUTSIDE a runner (file import,
  // sync merge, another device): whenever Home sees new attempts, any
  // level they earned is persisted, so the high-water record can never
  // lag the ledger for long. No-ops without the pack's opt-in.
  useEffect(() => {
    recordLevelCrossings(attempts);
  }, [attempts]);

  const showLevel = progressionEnabled && prefShown;
  const { streak, bestStreak, goal, answeredToday, remaining, goalMet } =
    streakProgress(attempts);
  const showStreak = !(streak === 0 && answeredToday === 0 && bestStreak === 0);
  if (!showLevel && !showStreak) return null;

  // The persisted high-water mark floors the displayed level, so a bank
  // that grew (stretching the ladder) never demotes anyone on screen.
  // Client-only read: this renders only after the pref effect ran.
  const p = showLevel
    ? levelProgress(
        totalXp(attempts),
        PACK_XP_LEVELS,
        recordedLevel(loadAchievements().map((e) => e.id)),
      )
    : null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-ink-200 bg-surface p-4 shadow-sm">
      {p ? (
        <div data-testid="level-card">
          <div className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-base leading-none"
              aria-hidden
            >
              {p.level.emoji}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">
              Level {p.level.level} · {p.level.name}
            </span>
            <span className="text-xs font-medium text-ink-500">{p.xp} XP</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full bg-brand-500 transition-all"
                style={{ width: `${p.pct}%` }}
              />
            </div>
            <span className="whitespace-nowrap text-xs text-ink-500">
              {p.next ? `${p.toNext} XP to ${p.next.name}` : 'Top of the ladder'}
            </span>
          </div>
        </div>
      ) : null}

      {p && showStreak ? <div className="border-t border-ink-100" /> : null}

      {showStreak ? (
        <div data-testid="streak-card">
          <div className="flex items-center gap-2">
            <Flame
              className={cn(
                'h-4 w-4 flex-shrink-0',
                goalMet ? 'text-brand-600' : 'text-warn-600',
              )}
            />
            <span className="text-sm font-semibold text-ink-900">
              {streak > 0 ? `${streak}-day streak` : 'Start a streak'}
            </span>
            {/* The record outlives any reset — a missed day never erases it. */}
            {bestStreak > streak ? (
              <span
                data-testid="best-streak"
                className="text-xs font-medium text-ink-500"
              >
                Best: {bestStreak} days
              </span>
            ) : null}
            <span className="ml-auto text-xs font-medium text-ink-500">
              {Math.min(answeredToday, goal)}/{goal}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100">
            <div
              className={cn(
                'h-full transition-all',
                goalMet ? 'bg-brand-500' : 'bg-warn-500',
              )}
              style={{
                width: `${Math.min(100, Math.round((answeredToday / goal) * 100))}%`,
              }}
            />
          </div>
          <div className="mt-1 text-xs text-ink-600">
            {goalMet
              ? "Today's in the bag — come back tomorrow to keep it going."
              : `${remaining} more ${remaining === 1 ? 'question' : 'questions'} today to ${
                  streak > 0 ? 'keep it alive' : 'lock in day one'
                }.`}
          </div>
        </div>
      ) : null}
    </div>
  );
}
