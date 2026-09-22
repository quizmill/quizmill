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

/** The ten mill-themed ranks, in order. Names are fixed; the XP each
 *  one costs is scaled to the pack — see {@link buildLevels}. */
export const LEVEL_LADDER: readonly { name: string; emoji: string }[] = [
  { name: 'Grain', emoji: '🌾' },
  { name: 'Fresh Flour', emoji: '🥖' },
  { name: 'Mill Hand', emoji: '🧺' },
  { name: 'Apprentice Miller', emoji: '🛠️' },
  { name: 'Stone Turner', emoji: '🪨' },
  { name: 'Journeyman Miller', emoji: '🥾' },
  { name: 'Wheelwright', emoji: '🛞' },
  { name: 'Millstone Master', emoji: '⚙️' },
  { name: 'Windmill Wizard', emoji: '🌬️' },
  { name: 'Master Miller', emoji: '🏰' },
];

/** Cumulative share of the pack's ladder scale each rank costs — early
 *  levels come quickly (a keen first week clears a couple), later ones
 *  take real mastery. */
const LEVEL_FRACTIONS = [0, 0.03, 0.08, 0.15, 0.24, 0.35, 0.48, 0.63, 0.8, 1];

/** Small banks get a floor so a 20-question pack can't be "mastered" in
 *  an afternoon — daily-goal bonuses and rescues carry the rest. */
export const MIN_LADDER_XP = 1000;

/**
 * Build the ladder for a pack of `questionCount` questions. The scale
 * is the XP of first-answering the whole bank correctly, so bigger
 * bank → longer ladder, automatically. Effort, rescue and daily-goal
 * XP also count toward it, so in practice the top rank arrives around
 * ~80% first-correct coverage rather than exactly 100% — deliberately
 * a touch generous: a kids' reward shouldn't be a coverage grind wall
 * that one unanswerable question can hold hostage. The ladder is
 * bounded on purpose — "finished" is a healthier endpoint for a
 * nine-year-old than an infinite grind.
 *
 * A pack's bank can grow (e.g. questions generated from notes), which
 * raises the thresholds; the persisted `level-N` records then act as a
 * display floor (see useLevelUp/levelProgress) so a level once reached
 * is never shown as lost.
 */
export function buildLevels(questionCount: number): XpLevel[] {
  const scale = Math.max(
    questionCount * (XP_EFFORT + XP_FIRST_CORRECT),
    MIN_LADDER_XP,
  );
  return LEVEL_LADDER.map((l, i) => ({
    level: i + 1,
    name: l.name,
    emoji: l.emoji,
    xp: Math.round((LEVEL_FRACTIONS[i] * scale) / 5) * 5,
  }));
}

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

/** The highest rung of `levels` whose threshold the XP total reached. */
export function levelForXp(xp: number, levels: readonly XpLevel[]): XpLevel {
  let reached = levels[0];
  for (const l of levels) {
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
  /** XP earned within the current level (0 when held up by the floor). */
  intoLevel: number;
  /** XP still needed for the next level; 0 at the top. */
  toNext: number;
  /** Progress through the current level, 0–100. */
  pct: number;
}

/**
 * Progress toward the next rung, for the Home level card. `floorLevel`
 * (the persisted high-water mark) keeps a level once reached on display
 * even if the ladder has since stretched under a grown bank — the bar
 * then simply reads empty until the derived XP catches back up.
 */
export function levelProgress(
  xp: number,
  levels: readonly XpLevel[],
  floorLevel = 1,
): LevelProgress {
  const derived = levelForXp(xp, levels);
  const level =
    levels.find((l) => l.level === Math.max(derived.level, floorLevel)) ??
    derived;
  const next = levels.find((l) => l.level === level.level + 1) ?? null;
  if (!next) {
    return { level, next: null, xp, intoLevel: Math.max(0, xp - level.xp), toNext: 0, pct: 100 };
  }
  const span = next.xp - level.xp;
  const intoLevel = Math.max(0, xp - level.xp);
  return {
    level,
    next,
    xp,
    intoLevel,
    toNext: next.xp - Math.max(xp, level.xp),
    pct: Math.min(100, Math.floor((intoLevel / span) * 100)),
  };
}
