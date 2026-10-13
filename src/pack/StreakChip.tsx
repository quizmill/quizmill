'use client';

import Link from 'next/link';
import { Flame } from 'lucide-react';
import type { Attempt } from '@/data/types';
import { cn } from '@/lib/cn';
import { streakProgress } from '@/lib/stats';

/**
 * The one piece of status Home keeps once the progress card moved to the
 * Progress tab: a streak chip in the header. It reads "3-day streak" once
 * today's goal is met, "2 more today" while it isn't, and links to
 * Progress where the full bars live. Hidden until there is any streak
 * signal at all, like the streak row it stands in for.
 */
export function StreakChip({ attempts }: { attempts: readonly Attempt[] }) {
  const { streak, bestStreak, answeredToday, remaining, goalMet } =
    streakProgress(attempts);
  if (streak === 0 && answeredToday === 0 && bestStreak === 0) return null;

  const label = goalMet ? `${streak}-day streak` : `${remaining} more today`;
  return (
    <Link
      href="/progress/"
      data-testid="streak-chip"
      aria-label={`${label} — open Progress`}
      className={cn(
        'tap-feedback inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
        goalMet ? 'bg-brand-50 text-brand-700' : 'bg-warn-100 text-warn-700',
      )}
    >
      <Flame className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Link>
  );
}
