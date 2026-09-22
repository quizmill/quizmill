/**
 * XP + levels — the accumulating progression for packs that opt in via
 * the manifest `progression` block (kids' packs, mainly).
 *
 * Design constraints, deliberately chosen for a child audience (see the
 * PR that introduced this for the research trail):
 *  - XP is a PURE DERIVATION over the immutable attempt ledger, like
 *    streaks and stats — nothing stored, nothing to lose, nothing to
 *    drift between devices, and history earns credit retroactively.
 *  - The number only ever goes up. No spendable currency, no decay.
 *  - Mastery-weighted, not grind-weighted: the first correct answer to
 *    a question pays well (more if it rescues an earlier mistake);
 *    re-answering something already mastered pays a token effort point.
 *  - The ladder is BOUNDED and its criteria fixed and visible —
 *    informational competence feedback, not a slot machine. No random
 *    rewards anywhere.
 *
 * Formula changes are safe (everything recomputes), but the runner also
 * persists each level crossing as an opaque `level-N` achievement record
 * (see useLevelUp) — a high-water mark so a crossing is celebrated once,
 * ever, across devices. Rebalance by raising thresholds, not lowering
 * values, so a displayed level never goes backwards.
 */
import type { Attempt } from '@/data/types';
import { practiceDates } from './stats';

/** Every answered question — effort always pays, but only a token. */
export const XP_EFFORT = 1;
/** First-ever correct answer to a question — the real earner. */
export const XP_FIRST_CORRECT = 10;
/** Extra when that first correct heals an earlier wrong answer. */
export const XP_RESCUE_BONUS = 5;
/** Each day the practice goal is met (STREAK_MIN_QUESTIONS_PER_DAY). */
export const XP_DAILY_GOAL = 25;

export interface XpLevel {
  level: number;
  /** Mill-themed rank name — the app's brand is the mill. */
  name: string;
  emoji: string;
  /** Cumulative XP needed to reach this level. */
  xp: number;
}

/**
 * The ladder. Early levels come quickly (a keen first week clears 2–3),
 * later ones take real mastery. Bounded on purpose: "finished" is a
 * healthier endpoint for a nine-year-old than an infinite grind.
 */
export const LEVELS: readonly XpLevel[] = [
  { level: 1, name: 'Grain', emoji: '🌾', xp: 0 },
  { level: 2, name: 'Fresh Flour', emoji: '🥖', xp: 100 },
  { level: 3, name: 'Mill Hand', emoji: '🧺', xp: 250 },
  { level: 4, name: 'Apprentice Miller', emoji: '🛠️', xp: 450 },
  { level: 5, name: 'Stone Turner', emoji: '🪨', xp: 700 },
  { level: 6, name: 'Journeyman Miller', emoji: '🥾', xp: 1000 },
  { level: 7, name: 'Wheelwright', emoji: '🛞', xp: 1400 },
  { level: 8, name: 'Millstone Master', emoji: '⚙️', xp: 1900 },
  { level: 9, name: 'Windmill Wizard', emoji: '🌬️', xp: 2500 },
  { level: 10, name: 'Master Miller', emoji: '🏰', xp: 3200 },
];

/**
 * Total XP for an attempt history. Chronological walk so "first correct"
 * and "rescued" are judged by answer time, whatever order storage holds.
 */
export function totalXp(attempts: readonly Attempt[]): number {
  const sorted = [...attempts].sort((a, b) => a.answeredAt - b.answeredAt);
  const answeredCorrectly = new Set<string>();
  const answeredWrong = new Set<string>();
  let xp = 0;
  for (const a of sorted) {
    xp += XP_EFFORT;
    if (a.isCorrect) {
      if (!answeredCorrectly.has(a.questionId)) {
        xp += XP_FIRST_CORRECT;
        if (answeredWrong.has(a.questionId)) xp += XP_RESCUE_BONUS;
        answeredCorrectly.add(a.questionId);
      }
    } else {
      answeredWrong.add(a.questionId);
    }
  }
  xp += practiceDates(attempts).length * XP_DAILY_GOAL;
  return xp;
}

/** The highest level whose threshold the XP total has reached. */
export function levelForXp(xp: number): XpLevel {
  let reached = LEVELS[0];
  for (const l of LEVELS) {
    if (xp >= l.xp) reached = l;
    else break;
  }
  return reached;
}

export interface LevelProgress {
  level: XpLevel;
  /** Next rung, or null at the top of the ladder. */
  next: XpLevel | null;
  /** Total XP (echoed for display). */
  xp: number;
  /** XP earned within the current level. */
  intoLevel: number;
  /** XP still needed for the next level; 0 at the top. */
  toNext: number;
  /** Progress through the current level, 0–100. */
  pct: number;
}

/** Progress toward the next rung, for the Home level card. */
export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const next = LEVELS.find((l) => l.level === level.level + 1) ?? null;
  if (!next) {
    return { level, next: null, xp, intoLevel: xp - level.xp, toNext: 0, pct: 100 };
  }
  const span = next.xp - level.xp;
  const intoLevel = xp - level.xp;
  return {
    level,
    next,
    xp,
    intoLevel,
    toNext: span - intoLevel,
    pct: Math.min(100, Math.floor((intoLevel / span) * 100)),
  };
}
