'use client';

import { useEffect } from 'react';

/** Minimal shape the celebration toast needs to render — kept loose so
 *  any sticker-like object works. */
interface CelebrationAchievement {
  emoji: string;
  name: string;
  description: string;
}

interface CelebrationProps {
  achievement: CelebrationAchievement;
  onDone: () => void;
  /** Kicker above the title. Defaults to the sticker-unlock wording; the
   *  streak toast passes its own (it isn't a sticker). */
  label?: string;
}

/** Matches the `animate-celebration` keyframes in globals.css — the
 *  card has fully faded out by then. */
const DISMISS_MS = 2_000;

/**
 * "Sticker unlocked" toast. Pointer-events pass through to the page
 * beneath, and it auto-dismisses — it can never block the practice
 * flow, only decorate it.
 */
export function Celebration({
  achievement,
  onDone,
  label = 'Sticker unlocked',
}: CelebrationProps) {
  useEffect(() => {
    const t = setTimeout(onDone, DISMISS_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
      role="status"
      aria-live="polite"
      data-testid="celebration"
    >
      <div className="animate-celebration rounded-3xl bg-warn-500 px-8 py-6 text-center text-white shadow-2xl">
        <div className="text-6xl leading-none" aria-hidden>
          {achievement.emoji}
        </div>
        <div className="mt-2 text-sm font-semibold uppercase tracking-wider text-white/85">
          {label}
        </div>
        <div className="mt-1 text-2xl font-bold">{achievement.name}</div>
        <div className="mt-1 text-sm text-white/90">
          {achievement.description}
        </div>
      </div>
    </div>
  );
}
