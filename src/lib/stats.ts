/**
 * Pure aggregations over attempts and sessions, feeding the Progress
 * page and the achievements engine. All inputs are plain arrays so
 * these can be tested without any storage layer. Category definitions
 * are passed in (not imported from APP_CONFIG) for the same reason.
 */
import type { Attempt, Session } from '@/data/types';
import { currentStreak, toDayKey } from './streak';

export interface CategoryAccuracy {
  key: string;
  label: string;
  attempted: number;
  correct: number;
  accuracyPct: number;
}

/** Accuracy per pack category, in the order the categories are given.
 *  Categories with no attempts are included with zeroes. */
export function accuracyByCategory(
  attempts: readonly Attempt[],
  categories: readonly { key: string; label: string; shortLabel?: string }[],
): CategoryAccuracy[] {
  return categories.map((cat) => {
    let attempted = 0;
    let correct = 0;
    for (const a of attempts) {
      if (a.subject !== cat.key) continue;
      attempted += 1;
      if (a.isCorrect) correct += 1;
    }
    return {
      key: cat.key,
      label: cat.shortLabel ?? cat.label,
      attempted,
      correct,
      accuracyPct: attempted === 0 ? 0 : Math.round((correct / attempted) * 100),
    };
  });
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD, local time
  attempted: number;
  correct: number;
  accuracyPct: number;
}

/**
 * Accuracy per day, for one category (or all when null). Days with no
 * attempts are omitted; results are sorted oldest-first.
 */
export function accuracyByDay(
  attempts: readonly Attempt[],
  categoryKey: string | null,
): DailyPoint[] {
  const map = new Map<string, { attempted: number; correct: number }>();
  for (const a of attempts) {
    if (categoryKey && a.subject !== categoryKey) continue;
    const d = new Date(a.answeredAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    const row = map.get(key) ?? { attempted: 0, correct: 0 };
    row.attempted += 1;
    if (a.isCorrect) row.correct += 1;
    map.set(key, row);
  }
  return [...map.entries()]
    .map(([date, { attempted, correct }]) => ({
      date,
      attempted,
      correct,
      accuracyPct: Math.round((correct / attempted) * 100),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface QuestionAccuracy {
  questionId: string;
  categoryKey: string;
  attempted: number;
  correct: number;
  accuracyPct: number;
}

/**
 * Accuracy per question across the whole history — the "weak spots"
 * list. Sorted weakest-first by accuracy; ties prefer more attempts
 * (more reliable signal). A minimum-attempts threshold keeps one-off
 * unlucky answers from dominating.
 */
export function weakestQuestions(
  attempts: readonly Attempt[],
  minAttempts = 2,
): QuestionAccuracy[] {
  const map = new Map<
    string,
    { categoryKey: string; attempted: number; correct: number }
  >();
  for (const a of attempts) {
    const row = map.get(a.questionId) ?? {
      categoryKey: a.subject,
      attempted: 0,
      correct: 0,
    };
    row.attempted += 1;
    if (a.isCorrect) row.correct += 1;
    map.set(a.questionId, row);
  }
  return [...map.entries()]
    .filter(([, r]) => r.attempted >= minAttempts)
    .map(([questionId, r]) => ({
      questionId,
      categoryKey: r.categoryKey,
      attempted: r.attempted,
      correct: r.correct,
      accuracyPct: Math.round((r.correct / r.attempted) * 100),
    }))
    .sort((a, b) => {
      if (a.accuracyPct !== b.accuracyPct) return a.accuracyPct - b.accuracyPct;
      return b.attempted - a.attempted;
    });
}

export function completedSessionDates(sessions: readonly Session[]): Date[] {
  return sessions
    .filter((s): s is Session & { endedAt: number } => s.endedAt !== null)
    .map((s) => new Date(s.endedAt));
}

/**
 * How many questions must be answered in a day for it to count toward the
 * daily-practice streak — one full round (QUESTION_COUNT). The questions don't
 * have to come from a single finished session (the bug this fixes: tapping
 * through the final question is what writes `endedAt`), they just have to add
 * up to a round across the day.
 */
export const STREAK_MIN_QUESTIONS_PER_DAY = 10;

/**
 * Days on which the user answered at least {@link STREAK_MIN_QUESTIONS_PER_DAY}
 * questions — the signal behind the daily-practice streak. Unlike
 * {@link completedSessionDates}, this doesn't require clicking all the way
 * through a session's final question (which is what writes `endedAt`): a day of
 * real practice that was left mid-session still counts. Attempts are recorded
 * per answer and are immutable, so they're also the reliable cross-device
 * signal. A representative Date is returned per qualifying local day.
 */
export function practiceDates(
  attempts: readonly Attempt[],
  minPerDay: number = STREAK_MIN_QUESTIONS_PER_DAY,
): Date[] {
  // Tally answered questions per local calendar day.
  const perDay = new Map<string, { date: Date; count: number }>();
  for (const a of attempts) {
    const date = new Date(a.answeredAt);
    const key = toDayKey(date);
    const entry = perDay.get(key);
    if (entry) entry.count += 1;
    else perDay.set(key, { date, count: 1 });
  }
  return [...perDay.values()].filter((e) => e.count >= minPerDay).map((e) => e.date);
}

export interface StreakProgress {
  /** Current streak length in days (includes today once the goal is met,
   *  otherwise the live run counting back from yesterday). */
  streak: number;
  /** Questions needed in a day to keep the streak (the daily goal). */
  goal: number;
  /** Questions answered so far today (local). */
  answeredToday: number;
  /** Questions still needed today to secure the streak; 0 once met. */
  remaining: number;
  /** True once today clears the goal. */
  goalMet: boolean;
}

/**
 * Today's standing against the daily-practice goal — drives the "X to keep your
 * streak" nudge on Home and the streak-kept celebration in the runner. Counting
 * `remaining` toward a visible goal is the bit that stops people giving up
 * after a few questions.
 */
export function streakProgress(
  attempts: readonly Attempt[],
  today: Date = new Date(),
  goal: number = STREAK_MIN_QUESTIONS_PER_DAY,
): StreakProgress {
  const todayKey = toDayKey(today);
  let answeredToday = 0;
  for (const a of attempts) {
    if (toDayKey(new Date(a.answeredAt)) === todayKey) answeredToday += 1;
  }
  return {
    streak: currentStreak(practiceDates(attempts, goal), today),
    goal,
    answeredToday,
    remaining: Math.max(0, goal - answeredToday),
    goalMet: answeredToday >= goal,
  };
}

export interface SessionSummary {
  /** Completed sessions (endedAt set); abandoned ones aren't counted. */
  sessions: number;
  /** Questions across completed sessions. */
  questions: number;
  /** Median session length in whole seconds; 0 with no completed sessions. */
  medianDurationSeconds: number;
  /** Median questions per session; 0 with no completed sessions. */
  medianQuestions: number;
}

/** Median of a list; the even case averages the middle pair. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Headline session numbers for the Progress page. Medians, not means —
 * a single marathon session shouldn't distort "typical".
 */
export function sessionSummary(sessions: readonly Session[]): SessionSummary {
  const done = sessions.filter(
    (s): s is Session & { endedAt: number } => s.endedAt !== null,
  );
  const durations = done.map((s) =>
    Math.max(0, Math.round((s.endedAt - s.startedAt) / 1000)),
  );
  return {
    sessions: done.length,
    questions: done.reduce((sum, s) => sum + s.questionCount, 0),
    medianDurationSeconds: Math.round(median(durations)),
    medianQuestions: Math.round(median(done.map((s) => s.questionCount))),
  };
}

export interface WeekdayCount {
  /** 0 = Monday … 6 = Sunday. */
  day: number;
  label: string;
  sessions: number;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Completed sessions per local weekday (of the start time), Monday-first,
 * always all 7 days. Feeds the "when do you practise" chart.
 */
export function sessionsByWeekday(sessions: readonly Session[]): WeekdayCount[] {
  const counts = new Array<number>(7).fill(0);
  for (const s of sessions) {
    if (s.endedAt === null) continue;
    counts[(new Date(s.startedAt).getDay() + 6) % 7] += 1;
  }
  return WEEKDAY_LABELS.map((label, day) => ({ day, label, sessions: counts[day] }));
}

export interface LevelNudge {
  direction: 'up' | 'down';
  from: string; // current level key
  to: string; // suggested adjacent level key
  accuracyPct: number; // recent accuracy at `from`
  sample: number; // attempts weighed
}

export interface LevelNudgeOptions {
  /** How many of the most-recent attempts at the level to weigh. */
  window?: number;
  /** Don't nudge until this many attempts at the level exist. */
  minSample?: number;
  /** Recent accuracy at/above this suggests moving up. */
  upPct?: number;
  /** Recent accuracy at/below this suggests moving down. */
  downPct?: number;
}

/**
 * Adaptive level nudge: suggest moving up or down a level based on how the
 * learner is doing at the level they're currently on. Pure and generic —
 * attempts only store the category, so `levelOf` maps a questionId to its
 * level key (undefined if none); `levelKeys` is the manifest level order;
 * `current` is the active level filter (null = "All").
 *
 * Returns null when there's no clear signal: no level selected, too few
 * attempts at it, accuracy in the unremarkable middle, or already at the
 * relevant end of the ladder.
 */
export function levelNudge(
  attempts: readonly Attempt[],
  levelOf: (questionId: string) => string | undefined,
  levelKeys: readonly string[],
  current: string | null,
  opts: LevelNudgeOptions = {},
): LevelNudge | null {
  const { window = 8, minSample = 5, upPct = 80, downPct = 40 } = opts;
  if (!current) return null;
  const idx = levelKeys.indexOf(current);
  if (idx < 0) return null;

  const recent = attempts
    .filter((a) => levelOf(a.questionId) === current)
    .sort((a, b) => b.answeredAt - a.answeredAt)
    .slice(0, window);
  if (recent.length < minSample) return null;

  const correct = recent.filter((a) => a.isCorrect).length;
  const accuracyPct = Math.round((correct / recent.length) * 100);
  const up = levelKeys[idx + 1];
  const down = levelKeys[idx - 1];

  if (accuracyPct >= upPct && up) {
    return { direction: 'up', from: current, to: up, accuracyPct, sample: recent.length };
  }
  if (accuracyPct <= downPct && down) {
    return { direction: 'down', from: current, to: down, accuracyPct, sample: recent.length };
  }
  return null;
}
