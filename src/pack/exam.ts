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
 * The smallest share of the declared `questionCount` a band must hold to
 * be dealt as a timed sitting. A 30-question sample of a 75-question exam
 * deals seven from its top level — that is a quiz under a clock, not a
 * mock, and the Check already does the short timed sitting better. A
 * 60-of-75 band is still worth sitting. Engine policy, not a manifest
 * field.
 */
export const EXAM_SITTING_MIN_FRACTION = 0.5;

/**
 * Size one sitting: as many questions as the real exam, capped at what
 * the band holds. A smaller sitting gets proportionally less time, so
 * the seconds-per-question stay those of the real exam — down to the
 * floor (EXAM_SITTING_MIN_FRACTION), below which there is no sitting.
 * With no `questionCount` to pro-rate against, the sitting is the whole
 * band in the full time.
 */
export function sittingPlan(
  exam: Pick<PackExam, 'questionCount' | 'durationMinutes'>,
  bankSize: number,
): { count: number; durationSeconds: number } | null {
  if (exam.durationMinutes === undefined) return null;
  if (exam.questionCount && bankSize < exam.questionCount * EXAM_SITTING_MIN_FRACTION) return null;
  const count = Math.min(exam.questionCount ?? bankSize, bankSize);
  const fullSeconds = exam.durationMinutes * 60;
  const durationSeconds = exam.questionCount
    ? Math.round((fullSeconds * count) / exam.questionCount)
    : fullSeconds;
  return { count, durationSeconds };
}

/** Build the sitting for a manifest + bank, or null when the pack
 *  declares no `durationMinutes` or the chosen band is empty or below
 *  the floor. */
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

/**
 * The real exam as declared (`questionCount` in `durationMinutes`) when
 * the floor is what withholds the sitting — a sample of a bigger bank.
 * Null whenever there is a sitting, or no declared size to fall short of.
 * Home shows it as a locked tile when the pack points at its full edition.
 */
export function withheldSitting(
  exam: PackExam | undefined,
  levelKeys: readonly string[],
  questions: readonly PackQuestion[],
): { count: number; durationSeconds: number } | null {
  if (!exam?.questionCount || exam.durationMinutes === undefined) return null;
  if (buildSitting(exam, levelKeys, questions)) return null;
  return { count: exam.questionCount, durationSeconds: exam.durationMinutes * 60 };
}

/** The ACTIVE pack's timed sitting, or null when it has none. */
export const EXAM_SITTING: ExamSitting | null = buildSitting(
  packExam,
  packLevelKeys,
  packQuestions,
);

/** The ACTIVE pack's full exam when the floor withholds its sitting. */
export const EXAM_WITHHELD = withheldSitting(packExam, packLevelKeys, packQuestions);

/**
 * Whether a score meets the pack's declared pass mark. Compares the exact
 * fraction, not the whole-number percentage shown on screen — 4/6 reads
 * as 67% but is below a 67% mark.
 */
export function passed(
  exam: Pick<PackExam, 'passPct'>,
  score: { correct: number; total: number },
): boolean {
  return score.total > 0 && score.correct * 100 >= exam.passPct * score.total;
}
