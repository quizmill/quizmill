/**
 * Achievement evaluation — pure functions over (sessions, attempts).
 *
 * The runtime calls `newlyEarnedAchievements` after every recorded
 * attempt: pass in the existing set of earned IDs, get back the IDs
 * that crossed a threshold THIS evaluation. The caller persists them
 * and (optionally) triggers a celebration UI for each.
 *
 * The achievement list is a parameter (defaulting to the active pack's
 * ACHIEVEMENTS) so tests can evaluate against synthetic packs.
 */
import type { Attempt, Session } from '@/data/types';
import { ACHIEVEMENTS, type Achievement } from '@/pack/achievements';
import { completedSessionDates } from '@/lib/stats';
import { currentStreak } from '@/lib/streak';

/** Mastery: this accuracy on at least this many attempts in a category. */
export const MASTERY_MIN_ATTEMPTS = 30;
export const MASTERY_MIN_ACCURACY = 0.8;

/** 'perfect-session' needs a full-size round, not a 3-question rump. */
export const PERFECT_SESSION_MIN_QUESTIONS = 10;

/**
 * Walk attempts in chronological order, tracking the longest run of
 * consecutive `isCorrect === true` attempts. Wrong answers reset the
 * run. Scope is the ENTIRE attempt history, not just one session.
 */
export function maxConsecutiveCorrect(attempts: readonly Attempt[]): number {
  const sorted = [...attempts].sort((a, b) => a.answeredAt - b.answeredAt);
  let max = 0;
  let current = 0;
  for (const a of sorted) {
    if (a.isCorrect) {
      current += 1;
      if (current > max) max = current;
    } else {
      current = 0;
    }
  }
  return max;
}

/**
 * Return the set of achievement IDs earned given the full history,
 * regardless of what was previously recorded as earned.
 */
export function evaluateAchievements(
  sessions: readonly Session[],
  attempts: readonly Attempt[],
  achievements: readonly Achievement[] = ACHIEVEMENTS,
  now: Date = new Date(),
): Set<string> {
  const earned = new Set<string>();

  // Shared aggregates, computed once.
  const bestRun = maxConsecutiveCorrect(attempts);
  const totalAnswered = attempts.length;
  const dailyStreak = currentStreak(completedSessionDates(sessions), now);

  for (const a of achievements) {
    switch (a.category) {
      case 'streak':
        if (a.threshold !== undefined && bestRun >= a.threshold) earned.add(a.id);
        break;
      case 'volume':
        if (a.threshold !== undefined && totalAnswered >= a.threshold) earned.add(a.id);
        break;
      case 'daily':
        if (a.threshold !== undefined && dailyStreak >= a.threshold) earned.add(a.id);
        break;
      case 'mastery': {
        if (!a.categoryKey) break;
        let attempted = 0;
        let correct = 0;
        for (const at of attempts) {
          if (at.subject !== a.categoryKey) continue;
          attempted += 1;
          if (at.isCorrect) correct += 1;
        }
        if (
          attempted >= MASTERY_MIN_ATTEMPTS &&
          correct / attempted >= MASTERY_MIN_ACCURACY
        ) {
          earned.add(a.id);
        }
        break;
      }
      case 'milestone':
        if (milestoneEarned(a.id, sessions)) earned.add(a.id);
        break;
    }
  }

  return earned;
}

/**
 * Progress toward a single locked achievement, for the cabinet's
 * "tap a locked one to see how" detail. Milestones are one-off events
 * (no meaningful count toward them), so they return null — their
 * description is the whole story.
 */
export interface AchievementProgress {
  /** Count achieved so far (may exceed `target` for streak/volume). */
  current: number;
  /** Count needed to unlock. */
  target: number;
  /** What the bar counts, e.g. 'best streak', 'questions answered'. */
  label: string;
  /** Optional extra gate, e.g. mastery's accuracy requirement. */
  detail?: string;
}

/**
 * Aggregates shared across every achievement's progress, computed once
 * so the cabinet doesn't re-walk the full history per tile.
 */
export interface ProgressContext {
  bestRun: number;
  totalAnswered: number;
  dailyStreak: number;
  mastery: Map<string, { attempted: number; correct: number }>;
}

export function buildProgressContext(
  sessions: readonly Session[],
  attempts: readonly Attempt[],
  now: Date = new Date(),
): ProgressContext {
  const mastery = new Map<string, { attempted: number; correct: number }>();
  for (const at of attempts) {
    const m = mastery.get(at.subject) ?? { attempted: 0, correct: 0 };
    m.attempted += 1;
    if (at.isCorrect) m.correct += 1;
    mastery.set(at.subject, m);
  }
  return {
    bestRun: maxConsecutiveCorrect(attempts),
    totalAnswered: attempts.length,
    dailyStreak: currentStreak(completedSessionDates(sessions), now),
    mastery,
  };
}

/** Map one achievement to its progress, given precomputed aggregates. */
export function achievementProgress(
  a: Achievement,
  ctx: ProgressContext,
): AchievementProgress | null {
  switch (a.category) {
    case 'streak':
      if (a.threshold === undefined) return null;
      return { current: ctx.bestRun, target: a.threshold, label: 'best streak' };
    case 'volume':
      if (a.threshold === undefined) return null;
      return {
        current: ctx.totalAnswered,
        target: a.threshold,
        label: 'questions answered',
      };
    case 'daily':
      if (a.threshold === undefined) return null;
      return { current: ctx.dailyStreak, target: a.threshold, label: 'day streak' };
    case 'mastery': {
      if (!a.categoryKey) return null;
      const m = ctx.mastery.get(a.categoryKey) ?? { attempted: 0, correct: 0 };
      const pct = m.attempted
        ? Math.round((m.correct / m.attempted) * 100)
        : 0;
      // The bar tracks the volume gate (need MASTERY_MIN_ATTEMPTS); the
      // accuracy gate rides along as detail since both must be met.
      return {
        current: Math.min(m.attempted, MASTERY_MIN_ATTEMPTS),
        target: MASTERY_MIN_ATTEMPTS,
        label: 'questions practised',
        detail: `${pct}% correct so far — need ${Math.round(
          MASTERY_MIN_ACCURACY * 100,
        )}%`,
      };
    }
    case 'milestone':
      return null;
  }
}

/** Milestones are id-specific — adding one means a case here. */
function milestoneEarned(id: string, sessions: readonly Session[]): boolean {
  switch (id) {
    case 'first-session':
      return sessions.some((s) => s.endedAt !== null);
    case 'perfect-session':
      return sessions.some(
        (s) =>
          s.endedAt !== null &&
          s.questionCount >= PERFECT_SESSION_MIN_QUESTIONS &&
          s.correctCount === s.questionCount,
      );
    case 'comeback':
      return sessions.some((s) => s.endedAt !== null && s.mode === 'review');
    default:
      return false;
  }
}

/**
 * Diff: given current history and the IDs already credited, return the
 * NEW ones in canonical (definition) order so multi-tier unlocks are
 * celebrated lowest-to-highest. Stored IDs that no longer exist in the
 * definitions (e.g. after a pack swap) harmlessly never match.
 */
export function newlyEarnedAchievements(
  sessions: readonly Session[],
  attempts: readonly Attempt[],
  alreadyEarned: ReadonlySet<string>,
  achievements: readonly Achievement[] = ACHIEVEMENTS,
  now: Date = new Date(),
): string[] {
  const all = evaluateAchievements(sessions, attempts, achievements, now);
  const fresh: string[] = [];
  for (const a of achievements) {
    if (all.has(a.id) && !alreadyEarned.has(a.id)) fresh.push(a.id);
  }
  return fresh;
}
