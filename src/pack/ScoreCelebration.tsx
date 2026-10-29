'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * How loudly a saved score is celebrated. Scales with the mark: a big
 * show for a perfect sheet, confetti for a high one, a sparkle for a
 * middling one, and for a low one a warm card with no effects at all —
 * nothing on screen should read as a fanfare for getting things wrong.
 */
export type ScoreTier = 'perfect' | 'great' | 'good' | 'steady';

export function scoreTier(correct: number, answered: number): ScoreTier {
  if (answered <= 0) return 'steady';
  if (correct >= answered) return 'perfect';
  const ratio = correct / answered;
  if (ratio >= 0.8) return 'great';
  if (ratio >= 0.5) return 'good';
  return 'steady';
}

const TIERS: Record<
  ScoreTier,
  { emoji: string; title: string; card: string; confetti: number }
> = {
  perfect: {
    emoji: '🏆',
    title: 'Perfect score!',
    card: 'animate-score-glow border-warn-500/60 bg-gradient-to-br from-warn-100 via-warn-50 to-brand-50',
    confetti: 90,
  },
  great: {
    emoji: '🌟',
    title: 'Brilliant work!',
    card: 'border-success-500/40 bg-gradient-to-br from-success-100 to-success-50',
    confetti: 40,
  },
  good: {
    emoji: '👏',
    title: 'Well done!',
    card: 'border-brand-500/30 bg-brand-50',
    confetti: 0,
  },
  steady: {
    emoji: '💪',
    title: 'Good effort — keep going!',
    card: 'border-brand-500/30 bg-brand-50',
    confetti: 0,
  },
};

const CONFETTI_COLOURS = [
  'rgb(var(--brand-500))',
  'rgb(var(--success-500))',
  'rgb(var(--warn-500))',
  '#ec4899',
  '#8b5cf6',
  '#facc15',
];

export interface ConfettiPiece {
  /** % across the viewport. */
  left: number;
  /** Seconds. */
  delay: number;
  duration: number;
  /** Sideways drift over the fall, px. */
  drift: number;
  /** Total spin over the fall, degrees. */
  spin: number;
  /** px. */
  size: number;
  colour: string;
  round: boolean;
}

/** A fixed-seed burst: the same pieces every render, so React never
 *  reshuffles them mid-fall and tests can count on the layout. */
export function confettiPieces(count: number): ConfettiPiece[] {
  // mulberry32 — tiny, good enough for scattering paper.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => ({
    // Even spread with jitter, so no corner of the screen stays empty.
    left: ((i + rand()) / count) * 100,
    // Two waves: the first lands with the card, the second a beat later.
    delay: (i % 2 === 0 ? 0 : 0.6) + rand() * 0.5,
    duration: 2.4 + rand() * 1.4,
    drift: (rand() - 0.5) * 160,
    spin: (rand() < 0.5 ? -1 : 1) * (360 + rand() * 540),
    size: 7 + rand() * 6,
    colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
    round: rand() < 0.3,
  }));
}

/** The longest fall above (delay + duration), plus a margin — then the
 *  overlay leaves the DOM. */
const CONFETTI_MS = 5_000;

/** Full-screen confetti. Decorative only: hidden from assistive tech,
 *  click-through, and not rendered at all under reduced motion. */
function Confetti({ count }: { count: number }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), CONFETTI_MS);
    return () => clearTimeout(t);
  }, []);
  if (!on) return null;
  return (
    <div
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden motion-reduce:hidden"
      aria-hidden
      data-testid="confetti"
    >
      {confettiPieces(count).map((p, i) => (
        <span
          key={i}
          className={cn('animate-confetti absolute top-0 block', p.round ? 'rounded-full' : 'rounded-[2px]')}
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 0.45,
              background: p.colour,
              '--confetti-delay': `${p.delay}s`,
              '--confetti-duration': `${p.duration}s`,
              '--confetti-drift': `${p.drift}px`,
              '--confetti-spin': `${p.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Where the sparkles twinkle around the card, as % of its box. */
const SPARKLES = [
  { top: -6, left: 8, delay: 0 },
  { top: 10, left: 92, delay: 0.25 },
  { top: 55, left: -3, delay: 0.5 },
  { top: 85, left: 88, delay: 0.15 },
  { top: -8, left: 70, delay: 0.4 },
  { top: 92, left: 20, delay: 0.65 },
];

/** A light twinkle around the card — the modest well-done. */
function Sparkles() {
  return (
    <div
      className="pointer-events-none absolute inset-0 motion-reduce:hidden"
      aria-hidden
      data-testid="sparkles"
    >
      {SPARKLES.map((s, i) => (
        <span
          key={i}
          className="animate-sparkle absolute text-xl"
          style={
            {
              top: `${s.top}%`,
              left: `${s.left}%`,
              '--sparkle-delay': `${s.delay}s`,
            } as CSSProperties
          }
        >
          {i % 2 === 0 ? '✨' : '⭐'}
        </span>
      ))}
    </div>
  );
}

/**
 * The score card on the paper-marking saved screen: headline, emoji and
 * score, dressed (and celebrated) by tier. `children` is the explanatory
 * copy under the score.
 */
export function ScoreCard({
  correct,
  answered,
  children,
}: {
  correct: number;
  answered: number;
  children?: ReactNode;
}) {
  const tier = scoreTier(correct, answered);
  const t = TIERS[tier];
  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-3 rounded-2xl border p-6 text-center shadow-xs',
        t.card,
      )}
      data-testid="score-card"
      data-tier={tier}
    >
      {t.confetti > 0 ? <Confetti count={t.confetti} /> : null}
      {tier === 'good' ? <Sparkles /> : null}
      <div
        className={cn(
          'animate-celebration-stay leading-none',
          tier === 'perfect' ? 'text-7xl' : tier === 'great' ? 'text-6xl' : 'text-5xl',
        )}
        aria-hidden
      >
        {t.emoji}
      </div>
      <div>
        <div
          className={cn(
            'font-semibold uppercase tracking-wider',
            tier === 'perfect'
              ? 'text-sm text-warn-700'
              : tier === 'great'
                ? 'text-sm text-success-700'
                : 'text-xs text-brand-700',
          )}
        >
          {t.title}
        </div>
        <div
          className={cn(
            'mt-1 font-bold text-ink-900',
            tier === 'perfect' || tier === 'great' ? 'text-3xl' : 'text-2xl',
          )}
        >
          {correct}/{answered} correct
        </div>
        {children}
      </div>
    </div>
  );
}
