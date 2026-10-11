'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Home, NotebookPen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  useRecordAttempt,
  useStartSession,
  useEndSession,
} from '@/lib/useStorage';
import { useMounted } from '@/lib/useMounted';
import { useLevelUp } from '@/pack/useLevelUp';
import { useAchievementUnlock } from '@/pack/useAchievementUnlock';
import {
  AnswerPanel,
  BackLink,
  QuestionPanel,
  RunnerCelebrations,
  RunnerLoading,
  RunnerResults,
  type Stage,
} from '@/pack/RunnerPanels';
import { amendAttempt, loadAttempts, loadNotes, loadSessions } from '@/lib/storage';
import { totalXp } from '@/lib/xp';
import { loadProgressionShown } from '@/lib/progressionPref';
import { notesPracticePool } from '@/pack/notes-practice';
import {
  isMultiAnswer,
  packQuestions,
  progressionEnabled,
  type OptionKey,
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

/** The runner opens from /notes, so that's where its back link goes. */
const backToNotes = <BackLink href="/notes/" label="My notes" />;

/**
 * Notes-focused practice runner: a round over the questions "around the
 * learner's notes" — the follow-ups generated from each noted question
 * (via `generatedFrom`) plus the noted questions themselves. Same
 * structure as the review runner (cross-category batch; attempts record
 * each question's own category), but an ordinary practice session — it
 * doesn't touch the mistake queue rules.
 */
export function PackNotesRunner() {
  const recordAttempt = useRecordAttempt();
  const startSession = useStartSession();
  const endSession = useEndSession();
  const { nextUnlock, checkNow, clearNextUnlock } = useAchievementUnlock();
  const { nextLevelUp, checkNow: checkLevelNow, clearNextLevelUp } = useLevelUp();

  const [state, setState] = useState<RunnerState | null>(null);
  const [nothingToPractice, setNothingToPractice] = useState(false);
  const mounted = useMounted();
  const [stage, setStage] = useState<Stage>('choosing');
  const [selected, setSelected] = useState<OptionKey[]>([]);
  // XP earned by the just-checked answer — see the practice runner.
  const [xpGained, setXpGained] = useState<number | null>(null);
  // First option tapped on the current question (first-instinct signal)
  // and the just-recorded attempt (to stamp feedbackSeconds on Next).
  const firstSelectedRef = useRef<OptionKey | null>(null);
  const lastAttemptRef = useRef<{ id: string; answeredAt: number } | null>(null);
  const [finished, setFinished] = useState(false);

  // Dealing the round records the session start (a storage write) as well
  // as setting state, so it stays an effect.
  /* eslint-disable react-hooks/set-state-in-effect -- see above */
  useEffect(() => {
    if (!mounted || state) return;
    const picked = notesPracticePool(loadNotes(), packQuestions);
    if (picked.length === 0) {
      setNothingToPractice(true);
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
    startSession(buildSessionStart(initial, picked[0].categoryKey, 'notes'));
    setState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (nothingToPractice) {
    return (
      <main className="flex flex-col gap-5">
        {backToNotes}
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 text-center shadow-xs">
          <h1 className="text-2xl font-bold text-ink-900">No note topics yet</h1>
          <p className="mt-2 text-ink-600">
            Add a note to a question while practising, and this round will
            gather that question — plus any follow-up questions generated
            from your notes — into one focused session.
          </p>
          <Link href="/notes/" className="mt-4 inline-block">
            <Button size="lg">
              <NotebookPen className="h-4 w-4" />
              See my notes
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!state) return <RunnerLoading back={backToNotes} />;

  const celebrations = (
    <RunnerCelebrations
      nextUnlock={nextUnlock}
      clearNextUnlock={clearNextUnlock}
      nextLevelUp={nextLevelUp}
      clearNextLevelUp={clearNextLevelUp}
    />
  );

  if (finished) {
    return (
      <RunnerResults
        eyebrow="Notes round complete"
        score={scoreSummary(state)}
        note="These were the questions around your notes — the ones you flagged and the follow-ups generated from them."
        back={backToNotes}
        celebrations={celebrations}
      >
        <Link href="/practice/notes/" className="block">
          <Button size="lg" block>
            <RefreshCw className="h-4 w-4" />
            Another notes round
          </Button>
        </Link>
        <Link href="/notes/" className="block">
          <Button size="lg" variant="secondary" block>
            <NotebookPen className="h-4 w-4" />
            Back to my notes
          </Button>
        </Link>
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
    // Snapshot XP before the write so the chip shows what this answer
    // earned (first-correct/rescue bonuses included).
    const showXp = progressionEnabled && loadProgressionShown();
    const xpBefore = showXp ? totalXp(loadAttempts()) : 0;
    const attempt = buildAttempt({
      state,
      question: current,
      selected,
      // Persist the question's actual category so per-category stats
      // stay accurate across a mixed notes session.
      categoryKey: current.categoryKey,
      now: Date.now(),
      attemptId: crypto.randomUUID(),
      mode: 'notes',
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
      endSession(buildSessionEnd(state, state.questions[0].categoryKey, Date.now(), 'notes'));
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
        back={backToNotes}
        badge={
          <span className="rounded-full border border-brand-500/50 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700">
            From your notes
          </span>
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
