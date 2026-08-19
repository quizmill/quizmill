'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PackChip } from '@/components/PackChip';
import { ArrowLeft, X } from 'lucide-react';
import {
  ACHIEVEMENTS,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type Achievement,
  type AchievementTier,
} from '@/pack/achievements';
import {
  achievementProgress,
  buildProgressContext,
  type AchievementProgress,
} from '@/pack/achievements-engine';
import { useEarnedAchievements, useStorageData } from '@/lib/useStorage';
import { cn } from '@/lib/cn';

/** The sticker cabinet: every achievement as a tile, earned ones in
 *  colour with their unlock date, locked ones greyed out with the tier.
 *  Tapping a locked tile opens a detail with progress toward unlocking. */
export default function StickersPage() {
  const { earned, earnedList } = useEarnedAchievements();
  const { sessions, attempts } = useStorageData();
  const earnedAtById = new Map(earnedList.map((e) => [e.id, e.earnedAt]));

  // Count only stickers that still exist in this pack's cabinet. Stored
  // ids can outlive their definitions (a category renamed/removed, an old
  // pack's stickers lingering in shared storage) — those don't render a
  // tile, so counting the raw stored list would show more than the bag holds.
  const earnedCount = ACHIEVEMENTS.filter((a) => earned.has(a.id)).length;

  // Aggregates for "how am I doing" — computed once, not per tile.
  const ctx = useMemo(
    () => buildProgressContext(sessions, attempts),
    [sessions, attempts],
  );

  // The locked sticker whose progress detail is open (null = closed).
  const [selected, setSelected] = useState<Achievement | null>(null);

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
          <span className="font-semibold text-ink-900">{earnedCount}</span>
          <span> / {ACHIEVEMENTS.length} stickers</span>
        </div>
      </header>

      <div>
        <PackChip className="mb-2" />
        <h1 className="text-3xl font-bold text-ink-900">Sticker cabinet</h1>
        <p className="mt-1 text-ink-500">
          Earn stickers by practising. Tap a locked one to see how.
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
                  onShowHow={() => setSelected(a)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {selected && (
        <StickerDetail
          achievement={selected}
          progress={achievementProgress(selected, ctx)}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}

interface StickerTileProps {
  achievement: Achievement;
  isEarned: boolean;
  earnedAt?: number;
  onShowHow: () => void;
}

function StickerTile({
  achievement,
  isEarned,
  earnedAt,
  onShowHow,
}: StickerTileProps) {
  const tileClass = cn(
    'flex flex-col items-center gap-1.5 rounded-2xl border-2 p-3 text-center shadow-sm',
    isEarned
      ? `bg-surface ${TIER_BORDER[achievement.tier]}`
      : 'border-ink-200 bg-ink-100/40',
  );

  const inner = (
    <>
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
    </>
  );

  // Earned tiles are static; locked tiles are tappable to reveal how to
  // unlock them. Keep the same data-testid/data-earned hooks on both.
  if (isEarned) {
    return (
      <div
        data-testid={`sticker-${achievement.id}`}
        data-earned="true"
        className={tileClass}
      >
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={`sticker-${achievement.id}`}
      data-earned="false"
      onClick={onShowHow}
      aria-label={`${achievement.name} — locked. See how to unlock it.`}
      className={cn(
        tileClass,
        'tap-feedback cursor-pointer transition-colors hover:bg-ink-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
      )}
    >
      {inner}
    </button>
  );
}

interface StickerDetailProps {
  achievement: Achievement;
  progress: AchievementProgress | null;
  onClose: () => void;
}

/** Modal detail for a locked sticker: the unlock criteria plus a live
 *  progress bar. Dismiss by backdrop tap, the close button, or Escape. */
function StickerDetail({ achievement, progress, onClose }: StickerDetailProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pct =
    progress && progress.target > 0
      ? Math.min(100, Math.round((progress.current / progress.target) * 100))
      : 0;
  const reached = progress ? Math.min(progress.current, progress.target) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-night-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`How to unlock ${achievement.name}`}
      data-testid="sticker-detail"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-surface p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-feedback -mr-2 -mt-2 rounded-full p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="text-6xl leading-none grayscale" aria-hidden>
          {achievement.emoji}
        </div>
        <div className="mt-2 text-xl font-bold text-ink-900">
          {achievement.name}
        </div>
        <div className="mt-1 text-sm font-semibold uppercase tracking-wider text-ink-400">
          Still locked
        </div>

        <div className="mt-4 rounded-2xl bg-ink-50 p-4 text-left">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            How to unlock
          </div>
          <div className="mt-1 text-sm text-ink-800">
            {achievement.description}
          </div>

          {progress ? (
            <div className="mt-4">
              <div className="flex items-baseline justify-between text-xs text-ink-500">
                <span className="font-medium text-ink-700">
                  {reached} / {progress.target}
                </span>
                <span>{progress.label}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-200">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all"
                  style={{ width: `${pct}%` }}
                  data-testid="sticker-detail-bar"
                />
              </div>
              {progress.detail && (
                <div className="mt-2 text-xs text-ink-500">{progress.detail}</div>
              )}
            </div>
          ) : (
            <div className="mt-3 text-xs text-ink-500">
              A one-off achievement — it unlocks the moment you do it.
            </div>
          )}
        </div>
      </div>
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
