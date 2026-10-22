'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Compass, Home, Play, RefreshCw } from 'lucide-react';
import { APP_CONFIG } from '@/config';
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
  type Stage,
} from '@/pack/RunnerPanels';
import { amendAttempt, loadAttempts, loadSessions } from '@/lib/storage';
import { sessionMistakeIds } from '@/lib/mistakes';
import { totalXp } from '@/lib/xp';
import { loadProgressionShown } from '@/lib/progressionPref';
import { formatSpan } from '@/lib/duration';
import { CHECK_MODE, CHECK_SUBJECT, checkHistory } from '@/lib/readinessCheck';
import { cn } from '@/lib/cn';
import { isMultiAnswer, progressionEnabled, type OptionKey } from '@/pack/data';
import { CHECK_PLAN, checkResultFor, dealCheckSitting } from '@/pack/check';
import { CheckResultView } from '@/pack/CheckResult';
import { VERDICT_META } from '@/pack/ExamReadiness';
import {
  advanceAfterAnswer,
  buildAttempt,
  buildSessionEnd,
  buildSessionStart,
  feedbackSecondsSince,
  isLastQuestion,
  moveToNext,
  nextSelection,
  type RunnerState,
} from './runner';

type Phase =
  | 'intro' // what the check is, the last result if any, and Start
  | 'sitting' // the questions, with feedback as in practice
  | 'done'; // the result page

/**
 * Readiness-check runner: one stratified sitting across every exam
 * domain (see src/pack/check.ts for the plan), feedback after each
 * answer exactly as in practice — the check is a learning session too —
 * and a result page built for planning rather than a score. Attempts
 * record as mode 'check' with each question's real category, so the
 * Progress readiness, mistakes and XP all count them; the session
 * carries the 'check' pseudo-subject. Sitting it again keeps the
 * previous result so the two can be compared.
 */
export function PackCheckRunner() {
  const plan = CHECK_PLAN;
  const exam = APP_CONFIG.exam;
  const { attempts, sessions } = useStorageData();
  const recordAttempt = useRecordAttempt();
  const startSession = useStartSession();
  const endSession = useEndSession();
  const { nextUnlock, checkNow, clearNextUnlock } = useAchievementUnlock();
  const { nextLevelUp, checkNow: checkLevelNow, clearNextLevelUp } = useLevelUp();

  const [phase, setPhase] = useState<Phase>('intro');
  const [state, setState] = useState<RunnerState | null>(null);
  const [stage, setStage] = useState<Stage>('choosing');
  const [selected, setSelected] = useState<OptionKey[]>([]);
  const [xpGained, setXpGained] = useState<number | null>(null);
  // The result on show: the sitting just finished, or a past one opened
  // from the intro.
  const [shownId, setShownId] = useState<string | null>(null);
  const firstSelectedRef = useRef<OptionKey | null>(null);
  const lastAttemptRef = useRef<{ id: string; answeredAt: number } | null>(null);

  const history = checkHistory(sessions);

  if (!plan || !exam) {
    return (
      <main className="flex flex-col gap-5">
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 text-center shadow-xs">
          <h1 className="text-2xl font-bold text-ink-900">No readiness check in this pack</h1>
          <p className="mt-2 text-ink-600">
            This pack doesn&apos;t declare an exam goal, so there&apos;s no pass line to
            check against.
          </p>
          <Link href="/" className="mt-4 inline-block">
            <Button size="lg">Back to home</Button>
          </Link>
        </div>
      </main>
    );
  }

  const examName = exam.label ?? 'the exam';
  const domainCount = plan.perDomain.length;

  function handleStart() {
    const picked = dealCheckSitting(attempts);
    if (picked === null) return;
    const t = Date.now();
    const initial: RunnerState = {
      sessionId: crypto.randomUUID(),
      questions: picked,
      currentIndex: 0,
      correctCount: 0,
      startedAt: t,
      questionShownAt: t,
    };
    startSession(buildSessionStart(initial, CHECK_SUBJECT, CHECK_MODE));
    setState(initial);
    setStage('choosing');
    setSelected([]);
    setXpGained(null);
    firstSelectedRef.current = null;
    setPhase('sitting');
  }

  if (phase === 'intro') {
    const last = history[0] ?? null;
    const lastResult = last ? checkResultFor(attempts, last.id) : null;
    return (
      <main className="flex flex-col gap-5">
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Readiness check
          </div>
          <h1 className="mt-1 text-2xl font-bold text-ink-900">Could you pass {examName} today?</h1>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-ink-50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Questions
              </dt>
              <dd className="mt-0.5 text-xl font-bold text-ink-900">{plan.count}</dd>
            </div>
            <div className="rounded-xl bg-ink-50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Domains
              </dt>
              <dd className="mt-0.5 text-xl font-bold text-ink-900">{domainCount}</dd>
            </div>
            <div className="rounded-xl bg-ink-50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Pass mark
              </dt>
              <dd className="mt-0.5 text-xl font-bold text-ink-900">{exam.passPct}%</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-ink-600">
            {plan.count} questions spread across all {domainCount} domains
            {plan.minutes !== null
              ? ` — about ${formatSpan(plan.minutes * 60)} at the real exam's pace, usually quicker`
              : ''}
            . Questions you haven&apos;t seen come first. You get the answer and explanation
            after each one, as in practice; what makes it a cold look is that each question
            is asked once.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            At the end: whether you&apos;d clear the {exam.passPct}% pass line today, and
            which domains to study first — ranked by how much of the exam they are and how
            far below the line you were.
          </p>
          <Button size="lg" block className="mt-5" onClick={handleStart}>
            <Play className="h-4 w-4" />
            {last ? 'Sit it again' : 'Start the check'}
          </Button>
        </div>

        {last && lastResult ? (
          <section
            className="flex items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-surface p-4 shadow-xs"
            data-testid="check-last"
          >
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                Last check · {formatDay(last.startedAt)}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                    VERDICT_META[lastResult.report.verdict].pill,
                  )}
                >
                  {VERDICT_META[lastResult.report.verdict].emoji}{' '}
                  {VERDICT_META[lastResult.report.verdict].label}
                </span>
                <span className="text-sm text-ink-600">
                  {lastResult.report.estimatePct}% · {lastResult.correct}/{lastResult.answered}{' '}
                  correct
                </span>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setShownId(last.id);
                setPhase('done');
              }}
            >
              See result
            </Button>
          </section>
        ) : null}
      </main>
    );
  }

  if (phase === 'done') {
    const id = shownId ?? state?.sessionId ?? null;
    if (!id) return null;
    // The check before the one on show — what it is compared against.
    const idx = history.findIndex((s) => s.id === id);
    const previous = idx >= 0 ? (history[idx + 1] ?? null) : (history[0] ?? null);
    const mistakes = sessionMistakeIds(attempts, id).length;
    return (
      <main className="flex flex-col gap-5">
        <RunnerCelebrations
          nextUnlock={nextUnlock}
          clearNextUnlock={clearNextUnlock}
          nextLevelUp={nextLevelUp}
          clearNextLevelUp={clearNextLevelUp}
        />
        <BackLink />
        <CheckResultView sessionId={id} previous={previous} attempts={attempts} />
        <div className="flex flex-col gap-2">
          {mistakes > 0 ? (
            <Link href={`/practice/review/#session=${id}`} className="block">
              <Button size="lg" variant="secondary" block>
                <RefreshCw className="h-4 w-4" />
                Review {mistakes} {mistakes === 1 ? 'mistake' : 'mistakes'} from this check
              </Button>
            </Link>
          ) : null}
          <Button
            size="lg"
            variant="secondary"
            block
            onClick={() => {
              setState(null);
              setShownId(null);
              setPhase('intro');
            }}
          >
            <Compass className="h-4 w-4" />
            Sit it again later
          </Button>
          <Link href="/" className="block">
            <Button size="lg" variant="secondary" block>
              <Home className="h-4 w-4" />
              Back to home
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!state) return null;

  const current = state.questions[state.currentIndex];
  const multi = isMultiAnswer(current);

  function handleSelect(key: OptionKey) {
    if (stage !== 'choosing') return;
    firstSelectedRef.current ??= key;
    setSelected((prev) => nextSelection(prev, key, multi));
  }

  function handleCheck() {
    if (!state || selected.length === 0) return;
    const showXp = progressionEnabled && loadProgressionShown();
    const xpBefore = showXp ? totalXp(loadAttempts()) : 0;
    const attempt = buildAttempt({
      state,
      question: current,
      selected,
      // The question's real category, so readiness and per-category
      // stats see the check as ordinary first attempts.
      categoryKey: current.categoryKey,
      now: Date.now(),
      attemptId: crypto.randomUUID(),
      mode: CHECK_MODE,
      firstSelected: firstSelectedRef.current ?? undefined,
    });
    recordAttempt(attempt);
    lastAttemptRef.current = { id: attempt.id, answeredAt: attempt.answeredAt };
    // Achievements evaluate against what's now persisted — re-read so
    // this can't race the useStorageData snapshot.
    const freshAttempts = loadAttempts();
    if (showXp) setXpGained(totalXp(freshAttempts) - xpBefore);
    checkNow(loadSessions(), freshAttempts);
    checkLevelNow(freshAttempts);
    setState(advanceAfterAnswer(state, attempt.isCorrect));
    setStage('feedback');
  }

  function handleNext() {
    if (!state) return;
    if (lastAttemptRef.current) {
      amendAttempt(lastAttemptRef.current.id, {
        feedbackSeconds: feedbackSecondsSince(lastAttemptRef.current.answeredAt),
      });
      lastAttemptRef.current = null;
    }
    firstSelectedRef.current = null;
    setXpGained(null);
    if (isLastQuestion(state)) {
      endSession(buildSessionEnd(state, CHECK_SUBJECT, Date.now(), CHECK_MODE));
      // Session-shaped stickers can only unlock once the end record is written.
      checkNow(loadSessions(), loadAttempts());
      setShownId(state.sessionId);
      setPhase('done');
      return;
    }
    setState(moveToNext(state));
    setStage('choosing');
    setSelected([]);
  }

  return (
    <main className="flex flex-col gap-5">
      <RunnerCelebrations
        nextUnlock={nextUnlock}
        clearNextUnlock={clearNextUnlock}
        nextLevelUp={nextLevelUp}
        clearNextLevelUp={clearNextLevelUp}
      />
      <QuestionPanel
        question={current}
        position={state.currentIndex + 1}
        total={state.questions.length}
        selected={selected}
        stage={stage}
        onSelect={handleSelect}
        badge={
          <span className="rounded-full border border-ink-400/40 bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-700">
            Readiness check
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

/** "22 Oct" — the day a past check was sat. */
function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
