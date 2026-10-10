'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  useRecordAttempt,
  useStartSession,
  useEndSession,
  useStorageData,
} from '@/lib/useStorage';
import { useAchievementUnlock } from '@/pack/useAchievementUnlock';
import { useLevelUp } from '@/pack/useLevelUp';
import {
  AnswerPanel,
  BackLink,
  QuestionPanel,
  RunnerCelebrations,
  RunnerLoading,
  type Stage,
} from '@/pack/RunnerPanels';
import { amendAttempt, loadAttempts, loadSessions } from '@/lib/storage';
import { sessionMistakeIds, unresolvedMistakeIds } from '@/lib/mistakes';
import { totalXp } from '@/lib/xp';
import { loadProgressionShown } from '@/lib/progressionPref';
import {
  isMultiAnswer,
  packQuestions,
  progressionEnabled,
  type OptionKey,
  type PackQuestion,
} from '@/pack/data';
import {
  advanceAfterAnswer,
  buildAttempt,
  buildSessionEnd,
  buildSessionStart,
  feedbackSecondsSince,
  isLastQuestion,
  moveToNext,
  nextSelection,
  scoreSummary,
  type RunnerState,
} from './runner';

const REVIEW_BATCH_SIZE = 10;

/** `#session=<id>` narrows the review to the mistakes of that one session. */
function scopeFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash;
  return h.startsWith('#session=')
    ? decodeURIComponent(h.slice('#session='.length))
    : null;
}

/**
 * Review-mode runner: re-asks questions the user got wrong and hasn't
 * since rescued. Deals after mount so the localStorage history is in —
 * see the practice runner for the mount guard.
 *
 * Opened plain it works through the whole queue, oldest mistake first, a
 * batch at a time. Opened with `#session=<id>` (the paper marking page
 * does this) it re-asks only that session's mistakes, all of them, in
 * the order they were asked.
 */
export function PackReviewRunner() {
  const { attempts } = useStorageData();
  const recordAttempt = useRecordAttempt();
  const startSession = useStartSession();
  const endSession = useEndSession();
  const { nextUnlock, checkNow, clearNextUnlock } = useAchievementUnlock();
  const { nextLevelUp, checkNow: checkLevelNow, clearNextLevelUp } = useLevelUp();

  const [state, setState] = useState<RunnerState | null>(null);
  const [nothingToReview, setNothingToReview] = useState(false);
  const [scoped, setScoped] = useState(false);
  // XP earned by the just-checked answer — see the practice runner.
  const [xpGained, setXpGained] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>('choosing');
  // The chosen option key(s) — one for single-answer, several for
  // multi-answer ("select all") questions.
  const [selected, setSelected] = useState<OptionKey[]>([]);
  // First option tapped on the current question (first-instinct signal)
  // and the just-recorded attempt (to stamp feedbackSeconds on Next).
  const firstSelectedRef = useRef<OptionKey | null>(null);
  const lastAttemptRef = useRef<{ id: string; answeredAt: number } | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || state) return;
    const scope = scopeFromHash();
    setScoped(scope !== null);
    const ids =
      scope !== null
        ? sessionMistakeIds(attempts, scope)
        : unresolvedMistakeIds(attempts).slice(0, REVIEW_BATCH_SIZE);
    if (ids.length === 0) {
      setNothingToReview(true);
      return;
    }
    const byId = new Map(packQuestions.map((q) => [q.id, q]));
    const picked = ids
      .map((id) => byId.get(id))
      .filter((q): q is PackQuestion => q !== undefined);
    if (picked.length === 0) {
      setNothingToReview(true);
      return;
    }
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
    startSession(buildSessionStart(initial, picked[0].categoryKey, 'review'));
    setState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, attempts, state]);

  /** Results → next batch. Restarts in place: a link back to this same
   *  route wouldn't remount the runner, leaving the results screen up. */
  function handleReviewMore() {
    // A scoped review is finished — carry on with the rest of the queue.
    if (scoped) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }
    setState(null);
    setFinished(false);
    setStage('choosing');
    setSelected([]);
  }

  if (nothingToReview) {
    return (
      <main className="flex flex-col gap-5">
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 text-center shadow-xs">
          <h1 className="text-2xl font-bold text-ink-900">
            Nothing to review
          </h1>
          <p className="mt-2 text-ink-600">
            {scoped ? (
              <>
                Every mistake from that session has been rescued already —
                nothing left to go over.
              </>
            ) : (
              <>
                You haven&apos;t got any unresolved mistakes right now. Keep
                practising — questions you get wrong show up here so you can
                retry them.
              </>
            )}
          </p>
          <Link href="/" className="mt-4 inline-block">
            <Button size="lg">Back to home</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!state) return <RunnerLoading />;

  const celebrations = (
    <RunnerCelebrations
      nextUnlock={nextUnlock}
      clearNextUnlock={clearNextUnlock}
      nextLevelUp={nextLevelUp}
      clearNextLevelUp={clearNextLevelUp}
    />
  );

  if (finished) {
    const { correct, total, pct } = scoreSummary(state);
    return (
      <main className="flex flex-col gap-5">
        {celebrations}
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-8 text-center shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Review complete
          </div>
          <h1 className="mt-2 text-4xl font-bold text-ink-900">
            {correct}/{total}
          </h1>
          <p className="mt-1 text-lg font-medium text-ink-600">
            {pct}% rescued
          </p>
          <p className="mt-4 text-sm text-ink-500">
            Questions you got right have been removed from your mistake
            queue.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button size="lg" block onClick={handleReviewMore}>
              <RefreshCw className="h-4 w-4" />
              Review more
            </Button>
            <Link href="/" className="block">
              <Button size="lg" variant="secondary" block>
                <Home className="h-4 w-4" />
                Back to home
              </Button>
            </Link>
          </div>
        </div>
      </main>
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
    // Snapshot XP before the write so the chip shows what this answer
    // earned — in review that's often the rescue bonus, on purpose.
    const showXp = progressionEnabled && loadProgressionShown();
    const xpBefore = showXp ? totalXp(loadAttempts()) : 0;
    const attempt = buildAttempt({
      state,
      question: current,
      selected,
      // Persist the question's actual category so per-category stats
      // stay accurate across a mixed review session.
      categoryKey: current.categoryKey,
      now: Date.now(),
      attemptId: crypto.randomUUID(),
      mode: 'review',
      firstSelected: firstSelectedRef.current ?? undefined,
    });
    recordAttempt(attempt);
    lastAttemptRef.current = { id: attempt.id, answeredAt: attempt.answeredAt };
    // Same re-read rationale as the practice runner — see there.
    const freshAttempts = loadAttempts();
    if (showXp) setXpGained(totalXp(freshAttempts) - xpBefore);
    checkNow(loadSessions(), freshAttempts);
    checkLevelNow(freshAttempts);
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
      endSession(
        buildSessionEnd(state, state.questions[0].categoryKey, Date.now(), 'review'),
      );
      // The 'comeback' sticker unlocks on the review-session end record.
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
        badge={
          <span className="rounded-full border border-warn-500/50 bg-warn-100/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warn-700">
            Review mistakes
          </span>
        }
      />
      <AnswerPanel
        question={current}
        selected={selected}
        stage={stage}
        verdict={{ correct: 'Rescued.', wrong: "We'll bring this one back later." }}
        xpGained={xpGained}
        isLast={isLastQuestion(state)}
        onCheck={handleCheck}
        onNext={handleNext}
      />
    </main>
  );
}
