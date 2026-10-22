/**
 * The readiness check for the ACTIVE pack — what its `exam` block turns
 * into once the sampling plan (src/lib/readinessCheck.ts) is applied to
 * this pack's categories and in-scope bank. Pure derivations over the
 * manifest and the bank; the React runner (CheckRunner) is the I/O
 * shell, the way exam.ts serves ExamRunner.
 */
import { APP_CONFIG } from '@/config';
import type { Attempt } from '@/data/types';
import type { ReadinessDomainInput } from '@/lib/readiness';
import {
  CHECK_BUDGETS_MINUTES,
  checkResult,
  dealCheck,
  planCheck,
  recommendedCheckMinutes,
  type CheckPlan,
  type CheckResult,
} from '@/lib/readinessCheck';
import { EXAM_AVAILABLE_BY_CATEGORY, examInScope, packQuestions, type PackQuestion } from './data';
import { attemptHistory } from './runner';

/** The exam's domains: every pack category with its blueprint weight and
 *  in-scope bank size — the same inputs the Progress readiness panel
 *  builds its report over, so the two never disagree. */
export const READINESS_DOMAINS: ReadinessDomainInput[] = APP_CONFIG.categories.map((c) => ({
  key: c.key,
  label: c.shortLabel ?? c.label,
  weight: c.weight ?? 0,
  available: EXAM_AVAILABLE_BY_CATEGORY[c.key] ?? 0,
}));

/** Questions the check may deal: the exam's scope (readiness's rule). */
export const CHECK_BANK: PackQuestion[] = packQuestions.filter((q) => examInScope(q.id));

/** The ACTIVE pack's check sized for one time budget, or null when the
 *  pack declares no exam goal or has nothing in scope to deal. */
export function checkPlanFor(minutes: number): CheckPlan | null {
  return APP_CONFIG.exam ? planCheck(READINESS_DOMAINS, APP_CONFIG.exam, { minutes }) : null;
}

/** The budget the intro offers first (see `recommendedCheckMinutes`). */
export const CHECK_RECOMMENDED_MINUTES: number = APP_CONFIG.exam
  ? recommendedCheckMinutes(READINESS_DOMAINS, APP_CONFIG.exam)
  : CHECK_BUDGETS_MINUTES[CHECK_BUDGETS_MINUTES.length - 1];

/** The ACTIVE pack's check at the recommended budget — what Home and
 *  Progress describe, and the floor a result is judged at. */
export const CHECK_PLAN: CheckPlan | null = checkPlanFor(CHECK_RECOMMENDED_MINUTES);

/** Deal one sitting's deck for a budget, unseen questions first given the
 *  learner's history (see `dealCheck` for the order). */
export function dealCheckSitting(
  attempts: readonly Attempt[],
  minutes: number,
  rng?: () => number,
): { plan: CheckPlan; deck: PackQuestion[] } | null {
  const plan = checkPlanFor(minutes);
  if (!plan) return null;
  const seen = new Set(attemptHistory([...attempts]).keys());
  const deck = dealCheck(plan, CHECK_BANK, seen, rng);
  return deck.length === 0 ? null : { plan, deck };
}

/** Read one check's result against the pack's exam goal, judging each
 *  domain at the floor the plan could afford (a one-question look still
 *  counts when the time cap allowed no more). */
export function checkResultFor(
  attempts: readonly Attempt[],
  sessionId: string,
): CheckResult | null {
  const exam = APP_CONFIG.exam;
  if (!exam || !CHECK_PLAN) return null;
  return checkResult(exam, READINESS_DOMAINS, attempts, sessionId, {
    inScope: examInScope,
    floor: Math.max(1, CHECK_PLAN.floor),
  });
}
