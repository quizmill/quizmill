'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  ACHIEVEMENTS,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type Achievement,
  type AchievementTier,
} from '@/pack/achievements';
import { useEarnedAchievements } from '@/lib/useStorage';
import { cn } from '@/lib/cn';

/** The sticker cabinet: every achievement as a tile, earned ones in
 *  colour with their unlock date, locked ones greyed out with the tier. */
export default function StickersPage() {
  const { earned, earnedList } = useEarnedAchievements();
  const earnedAtById = new Map(earnedList.map((e) => [e.id, e.earnedAt]));

  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
        <div className="text-sm font-medium text-ink-500" data-testid="sticker-count">
          <span className="font-semibold text-ink-900">{earnedList.length}</span>
          <span> / {ACHIEVEMENTS.length} stickers</span>
        </div>
      </header>

      <div>
        <h1 className="text-3xl font-bold text-ink-900">Sticker cabinet</h1>
        <p className="mt-1 text-ink-500">
          Earn stickers by practising. Locked ones show how.
        </p>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const inCategory = ACHIEVEMENTS.filter((a) => a.category === cat);
        if (inCategory.length === 0) return null;
        return (
          <section key={cat} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              {CATEGORY_LABEL[cat]}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {inCategory.map((a) => (
                <StickerTile
                  key={a.id}
                  achievement={a}
                  isEarned={earned.has(a.id)}
                  earnedAt={earnedAtById.get(a.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

interface StickerTileProps {
  achievement: Achievement;
  isEarned: boolean;
  earnedAt?: number;
}

function StickerTile({ achievement, isEarned, earnedAt }: StickerTileProps) {
  return (
    <div
      data-testid={`sticker-${achievement.id}`}
      data-earned={isEarned ? 'true' : 'false'}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-2xl border-2 p-3 text-center shadow-sm',
        isEarned
          ? `bg-white ${TIER_BORDER[achievement.tier]}`
          : 'border-ink-200 bg-ink-100/40',
      )}
    >
      <div
        className={cn(
          'text-4xl leading-none',
          isEarned ? '' : 'grayscale opacity-30',
        )}
        aria-hidden
      >
        {achievement.emoji}
      </div>
      <div
        className={cn(
          'text-sm font-semibold leading-tight',
          isEarned ? 'text-ink-900' : 'text-ink-500',
        )}
      >
        {achievement.name}
      </div>
      <div className="text-xs leading-tight text-ink-500">
        {achievement.description}
      </div>
      {isEarned && earnedAt ? (
        <div className="text-[10px] uppercase tracking-wider text-ink-500">
          {formatEarned(earnedAt)}
        </div>
      ) : (
        <div
          className={cn(
            'text-[10px] uppercase tracking-wider',
            TIER_LABEL[achievement.tier],
          )}
        >
          {achievement.tier} · locked
        </div>
      )}
    </div>
  );
}

function formatEarned(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const TIER_BORDER: Record<AchievementTier, string> = {
  bronze: 'border-amber-400',
  silver: 'border-slate-400',
  gold: 'border-yellow-500',
  platinum: 'border-brand-500',
};

const TIER_LABEL: Record<AchievementTier, string> = {
  bronze: 'text-amber-600',
  silver: 'text-slate-500',
  gold: 'text-yellow-600',
  platinum: 'text-brand-600',
};
