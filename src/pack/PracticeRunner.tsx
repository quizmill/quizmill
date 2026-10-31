'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  useRecordAttempt,
  useStartSession,
  useEndSession,
  useStorageData,
} from '@/lib/useStorage';
import { useClientState, useMounted } from '@/lib/useMounted';
import { Celebration } from '@/components/Celebration';
import { useAchievementUnlock } from '@/pack/useAchievementUnlock';
import { useLevelUp } from '@/pack/useLevelUp';
import {
  AnswerPanel,
  BackLink,
  QuestionPanel,
  RunnerCelebrations,
  RunnerLoading,
  RunnerResults,
  type Stage,
} from '@/pack/RunnerPanels';
import { amendAttempt, loadAttempts, loadSessions } from '@/lib/storage';
import { streakProgress } from '@/lib/stats';
import { totalXp } from '@/lib/xp';
import { loadProgressionShown } from '@/lib/progressionPref';
import {
  isMultiAnswer,
  packQuestions,
  progressionEnabled,
  PACK_CATEGORY_LABEL,
  PACK_PAPER_BY_KEY,
  type OptionKey,
} from '@/pack/data';
import { paperSubject } from '@/pack/papers';
import {
  MIXED_LABEL,
  MIXED_SUBJECT,
  advanceAfterAnswer,
  attemptHistory,
  bankForCategory,
  bankForPaper,
  buildAttempt,
  buildSessionEnd,
  buildSessionStart,
  feedbackSecondsSince,
  filterByLevel,
  isBankFullySeen,
  isLastQuestion,
  loadPackLevelFilter,
  moveToNext,
  nextSelection,
  pickSessionFromBank,
  scoreSummary,
  QUESTION_COUNT,
  type RunnerState,
} from './runner';

/** What the runner deals from: one category (the level filter applies),
 *  every category at once (likewise), or one named paper — sat whole,
 *  whatever the level filter says. */
type Props =
  | {
      /** Pack category key from the manifest, e.g. 'planets'. */
      categoryKey: string;
      paperKey?: undefined;
      mixed?: undefined;
    }
  | {
      /** Manifest `papers` key (#194). */
      paperKey: string;
      categoryKey?: undefined;
      mixed?: undefined;
    }
  | {
      /** A mixed round across every category (#232). */
      mixed: true;
      categoryKey?: undefined;
      paperKey?: undefined;
    };

/**
 * Practice runner: deals a round from one category or the whole pack
 * (honouring the level filter) or one named paper, records each answer,
 * and celebrates stickers, level-ups and the daily streak as they land.
 */
export function PackPracticeRunner(props: Props) {
  // The scope's display label and the session's subject. A paper owned
  // by one category is that category's session; a cross-category paper
  // carries the `paper` pseudo-subject and a mixed round the `mixed` one
  // (attempts keep real categories).
  const paper = props.paperKey !== undefined ? PACK_PAPER_BY_KEY[props.paperKey] : undefined;
  const scopeLabel = paper
    ? paper.label
    : props.mixed
      ? MIXED_LABEL
      : (PACK_CATEGORY_LABEL[props.categoryKey ?? ''] ?? props.categoryKey ?? props.paperKey);
  const sessionSubject = paper
    ? paperSubject(paper)
    : (props.categoryKey ?? props.paperKey ?? MIXED_SUBJECT);
  const { attempts } = useStorageData();
  const recordAttempt = useRecordAttempt();
  const startSession = useStartSession();
  const endSession = useEndSession();
  const { nextUnlock, checkNow, clearNextUnlock } = useAchievementUnlock();
  const { nextLevelUp, checkNow: checkLevelNow, clearNextLevelUp } = useLevelUp();

  const [state, setState] = useState<RunnerState | null>(null);
  const [outOfQuestions, setOutOfQuestions] = useState(false);
  // Whether the dealt round is repeats by necessity (every question in the
  // set already attempted) — surfaced once so re-served questions read as
  // deliberate revision, not a broken picker.
  const [repeatRound, setRepeatRound] = useState(false);
  const mounted = useMounted();
  const [stage, setStage] = useState<Stage>('choosing');
  // The chosen option key(s). Single-answer questions hold one entry;
  // multi-answer ("select all") questions accumulate several.
  const [selected, setSelected] = useState<OptionKey[]>([]);
  const [finished, setFinished] = useState(false);
  // When today's practice goal is reached, the streak length to celebrate
  // (null when there's nothing to show). Distinct from sticker unlocks so a
  // plain day (1-day, 2-day…) still gets a nod, not only milestone days.
  const [streakDone, setStreakDone] = useState<number | null>(null);
  // XP earned by the just-checked answer, shown as a small chip in the
  // feedback panel. Null when progression is off (pack or device) or
  // between questions. A deterministic, explainable number on purpose —
  // never a surprise mechanic.
  const [xpGained, setXpGained] = useState<number | null>(null);
  // The active level-band filter (a manifest level key) or null = All.
  // Read from localStorage after mount, so SSR/first paint stay stable.
  const [levelFilter] = useClientState(loadPackLevelFilter, null);
  // First option tapped on the current question (first-instinct signal)
  // and the just-recorded attempt (to stamp feedbackSeconds on Next).
  const firstSelectedRef = useRef<OptionKey | null>(null);
  const lastAttemptRef = useRef<{ id: string; answeredAt: number } | null>(null);

  const { categoryKey, paperKey } = props;
  const bank = useMemo(
    () =>
      paperKey !== undefined
        ? bankForPaper(packQuestions, paperKey)
        : filterByLevel(
            categoryKey !== undefined ? bankForCategory(packQuestions, categoryKey) : packQuestions,
            levelFilter,
          ),
    [categoryKey, paperKey, levelFilter],
  );

  // Pick a session after mount (so localStorage attempts are reflected),
  // and again whenever `state` is cleared — that's how "Another round"
  // restarts: it sets state to null and relies on this effect re-running
  // to deal a fresh round. `state` must stay in the deps or the restart
  // hangs on the "Loading…" placeholder forever. Dealing records the
  // session start (a storage write) as well as setting state, so it
  // stays an effect.
  /* eslint-disable react-hooks/set-state-in-effect -- see above */
  useEffect(() => {
    if (!mounted || state) return;
    // A paper may span categories, so its history is not narrowed by one.
    const history = attemptHistory(attempts, categoryKey);
    // A paper is sat WHOLE — every question, however many — where a
    // category round is the usual ten.
    const picked = pickSessionFromBank(
      bank,
      history,
      undefined,
      paperKey !== undefined ? bank.length : QUESTION_COUNT,
    );
    if (picked === null) {
      setOutOfQuestions(true);
      return;
    }
    setRepeatRound(isBankFullySeen(bank, history));
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const initial: RunnerState = {
      sessionId,
      questions: picked,
      currentIndex: 0,
      correctCount: 0,
      startedAt: now,
      questionShownAt: now,
    };
    startSession(buildSessionStart(initial, sessionSubject));
    setState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, bank, categoryKey, paperKey, state]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (outOfQuestions) {
    return (
      <main className="flex flex-col gap-5">
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 text-center shadow-xs">
          <h1 className="text-2xl font-bold text-ink-900">No {scopeLabel} questions yet</h1>
          <p className="mt-2 text-ink-600">
            This pack has no questions for this {paperKey !== undefined ? 'paper' : 'category'} yet.
          </p>
          <Link href="/" className="mt-4 inline-block">
            <Button size="lg">Back to home</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!state) return <RunnerLoading />;

  // The streak nod belongs to the question screen only — the results
  // screen shows sticker and level-up toasts but never carried it, and the
  // toast lets taps through, so "See results" mid-toast would otherwise
  // drag it (and restart its dismissal timer) onto the results screen.
  const celebrations = (
    <RunnerCelebrations
      nextUnlock={nextUnlock}
      clearNextUnlock={clearNextUnlock}
      nextLevelUp={nextLevelUp}
      clearNextLevelUp={clearNextLevelUp}
      fallback={
        !finished && streakDone !== null ? (
          <Celebration
            label={streakDone === 1 ? 'Streak started' : 'Streak kept'}
            achievement={{
              emoji: '🔥',
              name: `${streakDone}-day streak!`,
              description:
                streakDone === 1
                  ? 'Day one done — come back tomorrow to build on it.'
                  : 'Nice run — see you tomorrow to extend it.',
            }}
            onDone={() => setStreakDone(null)}
          />
        ) : null
      }
    />
  );

  if (finished) {
    return (
      <RunnerResults
        eyebrow="Practice complete"
        score={scoreSummary(state)}
        note={scopeLabel}
        celebrations={celebrations}
      >
        <Button
          size="lg"
          block
          onClick={() => {
            setState(null);
            setFinished(false);
            setStage('choosing');
            setSelected([]);
          }}
        >
          <RefreshCw className="h-4 w-4" />
          Another round
        </Button>
        <Link href="/" className="block">
          <Button size="lg" variant="secondary" block>
            <Home className="h-4 w-4" />
            Back to home
          </Button>
        </Link>
      </RunnerResults>
    );
  }

  const current = state.questions[state.currentIndex];
  const multi = isMultiAnswer(current);

  function handleSelect(key: OptionKey) {
    if (stage !== 'choosing') return;
    firstSelectedRef.current ??= key;
    setSelected((prev) => nextSelection(prev, key, multi));
  }

  function handleCheck() {
    if (!state || selected.length === 0) return;
    // Snapshot XP before the write so the chip can show exactly what
    // this answer earned (first-correct/rescue bonuses included).
    const showXp = progressionEnabled && loadProgressionShown();
    const xpBefore = showXp ? totalXp(loadAttempts()) : 0;
    const attempt = buildAttempt({
      state,
      question: current,
      selected,
      // The question's own category — in a category round they agree; in
      // a cross-category paper this is what keeps category stats honest.
      categoryKey: current.categoryKey,
      now: Date.now(),
      attemptId: crypto.randomUUID(),
      mode: 'practice',
      firstSelected: firstSelectedRef.current ?? undefined,
    });
    recordAttempt(attempt);
    lastAttemptRef.current = { id: attempt.id, answeredAt: attempt.answeredAt };
    // Achievements evaluate against what's now persisted — re-read so
    // this can't race the useStorageData snapshot.
    const freshAttempts = loadAttempts();
    if (showXp) setXpGained(totalXp(freshAttempts) - xpBefore);
    const unlocked = checkNow(loadSessions(), freshAttempts);
    checkLevelNow(freshAttempts);
    // Celebrate keeping the streak the moment today's goal is met — but only
    // on the exact crossing, and not when a sticker already fired this turn
    // (that's celebration enough; avoids two toasts stacking).
    if (unlocked === 0) {
      const prog = streakProgress(freshAttempts);
      if (prog.goalMet && prog.answeredToday === prog.goal) {
        setStreakDone(prog.streak);
      }
    }
    setState(advanceAfterAnswer(state, attempt.isCorrect));
    setStage('feedback');
  }

  function handleNext() {
    if (!state) return;
    // How long the explanation was on screen — amended onto the attempt.
    if (lastAttemptRef.current) {
      amendAttempt(lastAttemptRef.current.id, {
        feedbackSeconds: feedbackSecondsSince(lastAttemptRef.current.answeredAt),
      });
      lastAttemptRef.current = null;
    }
    firstSelectedRef.current = null;
    setXpGained(null);
    if (isLastQuestion(state)) {
      endSession(buildSessionEnd(state, sessionSubject, Date.now()));
      // Session-shaped stickers (first session, flawless round, daily
      // streak) can only unlock once the end record is written.
      checkNow(loadSessions(), loadAttempts());
      setFinished(true);
      return;
    }
    setState(moveToNext(state));
    setStage('choosing');
    setSelected([]);
  }

  return (
    <main className="flex flex-col gap-5">
      {celebrations}
      <QuestionPanel
        question={current}
        position={state.currentIndex + 1}
        total={state.questions.length}
        selected={selected}
        stage={stage}
        onSelect={handleSelect}
        banner={
          repeatRound && state.currentIndex === 0 ? (
            <div
              data-testid="repeat-round-banner"
              className="flex items-center gap-3 rounded-2xl border border-brand-500/30 bg-brand-50 p-3 shadow-xs"
            >
              <RefreshCw className="h-4 w-4 shrink-0 text-brand-600" />
              <p className="text-sm text-ink-700">
                You&apos;ve answered every question in this set — this round
                revisits your mistakes and the ones you&apos;ve not seen for
                longest.
              </p>
            </div>
          ) : null
        }
      />
      <AnswerPanel
        question={current}
        selected={selected}
        stage={stage}
        verdict={{ correct: 'Correct.', wrong: 'Not quite.' }}
        xpGained={xpGained}
        isLast={isLastQuestion(state)}
        onCheck={handleCheck}
        onNext={handleNext}
      />
    </main>
  );
}
