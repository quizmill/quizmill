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
  checkResult,
  dealCheck,
  planCheck,
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

/** The ACTIVE pack's check, or null when it declares no exam goal or
 *  has nothing in scope to deal. */
export const CHECK_PLAN: CheckPlan | null = APP_CONFIG.exam
  ? planCheck(READINESS_DOMAINS, APP_CONFIG.exam)
  : null;

/** Deal one sitting, unseen questions first given the learner's history. */
export function dealCheckSitting(
  attempts: readonly Attempt[],
  rng?: () => number,
): PackQuestion[] | null {
  if (!CHECK_PLAN) return null;
  const seen = new Set(attemptHistory([...attempts]).keys());
  const dealt = dealCheck(CHECK_PLAN, CHECK_BANK, seen, rng);
  return dealt.length === 0 ? null : dealt;
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
