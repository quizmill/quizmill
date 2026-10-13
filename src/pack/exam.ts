/**
 * The timed exam sitting — what the pack's `exam` block turns into once
 * it declares `durationMinutes`. Pure derivations over the manifest and
 * the bank; the React runner (ExamRunner) is the I/O shell.
 */
import { packExam, packLevelKeys, packQuestions, type PackExam, type PackQuestion } from './data';

export interface ExamSitting {
  /** The level band the sitting deals from; null = the whole bank. */
  level: string | null;
  /** Questions the sitting can draw from. */
  bank: PackQuestion[];
  /** How many questions one sitting deals. */
  count: number;
  /** How long one sitting lasts. */
  durationSeconds: number;
}

/**
 * The level the timed sitting draws from: the exam's declared `scope`
 * level when it has one, otherwise the LAST declared level — manifest
 * levels are a ladder (see the adaptive nudge), so last is hardest — or
 * null (the whole bank) for a pack with no levels.
 */
export function sittingLevel(
  exam: Pick<PackExam, 'scope'>,
  levelKeys: readonly string[],
): string | null {
  return exam.scope?.level ?? levelKeys[levelKeys.length - 1] ?? null;
}

/**
 * Size one sitting: as many questions as the real exam, capped at what
 * the band holds. A smaller sitting gets proportionally less time, so
 * the seconds-per-question stay those of the real exam; with no
 * `questionCount` to pro-rate against, the sitting is the whole band in
 * the full time.
 */
export function sittingPlan(
  exam: Pick<PackExam, 'questionCount' | 'durationMinutes'>,
  bankSize: number,
): { count: number; durationSeconds: number } | null {
  if (exam.durationMinutes === undefined) return null;
  const count = Math.min(exam.questionCount ?? bankSize, bankSize);
  const fullSeconds = exam.durationMinutes * 60;
  const durationSeconds = exam.questionCount
    ? Math.round((fullSeconds * count) / exam.questionCount)
    : fullSeconds;
  return { count, durationSeconds };
}

/** Build the sitting for a manifest + bank, or null when the pack
 *  declares no `durationMinutes` or the chosen band has no questions. */
export function buildSitting(
  exam: PackExam | undefined,
  levelKeys: readonly string[],
  questions: readonly PackQuestion[],
): ExamSitting | null {
  if (!exam || exam.durationMinutes === undefined) return null;
  const level = sittingLevel(exam, levelKeys);
  const bank = questions.filter((q) => level === null || q.level === level);
  const plan = sittingPlan(exam, bank.length);
  if (!plan || plan.count === 0) return null;
  return { level, bank, ...plan };
}

/** The ACTIVE pack's timed sitting, or null when it has none. */
export const EXAM_SITTING: ExamSitting | null = buildSitting(
  packExam,
  packLevelKeys,
  packQuestions,
);

/** Whether a score meets the pack's declared pass mark. */
export function passed(exam: Pick<PackExam, 'passPct'>, pct: number): boolean {
  return pct >= exam.passPct;
}
