'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Compass, Flag, Home, Play, RefreshCw, Timer } from 'lucide-react';
import { APP_CONFIG } from '@/config';
import { Button } from '@/components/ui/Button';
import {
  useRecordAttempt,
  useStartSession,
  useEndSession,
  useStorageData,
} from '@/lib/useStorage';
import { useLatest } from '@/lib/useLatest';
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
import {
  elapsedSeconds,
  formatClock,
  isTimeUp,
  pauseClock,
  remainingSeconds,
  startClock,
  type ExamClock,
} from '@/lib/examClock';
import {
  CHECK_BUDGETS_MINUTES,
  CHECK_MODE,
  CHECK_SUBJECT,
  canDealAnother,
  checkHistory,
  checkPaceHint,
  checkVerdictGap,
  projectedCheckLength,
  type CheckPlan,
} from '@/lib/readinessCheck';
import { cn } from '@/lib/cn';
import { isMultiAnswer, progressionEnabled, type OptionKey } from '@/pack/data';
import {
  CHECK_PLAN,
  CHECK_RECOMMENDED_MINUTES,
  checkPlanFor,
  checkResultFor,
  dealCheckSitting,
} from '@/pack/check';
import { CheckResultView } from '@/pack/CheckResult';
import { VERDICT_META } from '@/pack/ExamReadiness';
import {
  advanceAfterAnswer,
  buildAttempt,
  buildSessionEnd,
  buildSessionStart,
  feedbackSecondsSince,
  moveToNext,
  nextSelection,
  type RunnerState,
} from './runner';

type Phase =
  | 'intro' // what the check is, the budget to pick, the last result if any, and Start
  | 'sitting' // the questions under the clock, with feedback as in practice
  | 'done'; // the result page

/** How the sitting closed: dealt out, stopped by the clock, or ended by
 *  the learner once the sample could carry a verdict. */
type Ending = 'finished' | 'timeUp' | 'endedEarly';

/**
 * Readiness-check runner: one time-boxed sitting across every exam
 * domain (see src/pack/check.ts for the plan and the deck), feedback
 * after each answer exactly as in practice — the check is a learning
 * session too — and a result page built for planning rather than a
 * score. The learner picks the budget (ten, twenty or thirty minutes,
 * never more); the deck is dealt one question at a time while the time
 * left still holds another at the learner's own pace, and the clock
 * ends the sitting outright when it runs out — nothing ever asks for
 * more time. Attempts record as mode 'check' with each question's real
 * category, so the Progress readiness, mistakes and XP all count them;
 * the session carries the 'check' pseudo-subject. Sitting it again
 * keeps the previous result so the two can be compared.
 */
export function PackCheckRunner() {
  const exam = APP_CONFIG.exam;
  const { attempts, sessions } = useStorageData();
  const recordAttempt = useRecordAttempt();
  const startSession = useStartSession();
  const endSession = useEndSession();
  const { nextUnlock, checkNow, clearNextUnlock } = useAchievementUnlock();
  const { nextLevelUp, checkNow: checkLevelNow, clearNextLevelUp } = useLevelUp();

  const [phase, setPhase] = useState<Phase>('intro');
  const [minutes, setMinutes] = useState<number>(CHECK_RECOMMENDED_MINUTES);
  const [plan, setPlan] = useState<CheckPlan | null>(CHECK_PLAN);
  const [state, setState] = useState<RunnerState | null>(null);
  const [clock, setClock] = useState<ExamClock | null>(null);
  // Re-read once a second while sitting so the countdown moves; the clock
  // itself is a pure value over Date.now() (src/lib/examClock.ts).
  const [now, setNow] = useState(() => Date.now());
  const [ending, setEnding] = useState<Ending>('finished');
  const [stage, setStage] = useState<Stage>('choosing');
  const [selected, setSelected] = useState<OptionKey[]>([]);
  const [xpGained, setXpGained] = useState<number | null>(null);
  // The result on show: the sitting just finished, or a past one opened
  // from the intro.
  const [shownId, setShownId] = useState<string | null>(null);
  const firstSelectedRef = useRef<OptionKey | null>(null);
  const lastAttemptRef = useRef<{ id: string; answeredAt: number } | null>(null);

  const history = checkHistory(sessions);
  const budgetSeconds = minutes * 60;

  /** Close the sitting over the questions actually answered: the
   *  session's count is what the clock allowed, not the deck. */
  function finish(finalState: RunnerState, answered: number, how: Ending) {
    const t = Date.now();
    if (lastAttemptRef.current) {
      amendAttempt(lastAttemptRef.current.id, {
        feedbackSeconds: feedbackSecondsSince(lastAttemptRef.current.answeredAt, t),
      });
      lastAttemptRef.current = null;
    }
    const closed = { ...finalState, questions: finalState.questions.slice(0, answered) };
    endSession(buildSessionEnd(closed, CHECK_SUBJECT, t, CHECK_MODE));
    // Session-shaped stickers can only unlock once the end record is written.
    checkNow(loadSessions(), loadAttempts());
    setState(closed);
    // Freeze the clock so the result page reports the time used at the
    // finish, however long it then stays open.
    setClock((c) => (c ? pauseClock(c, t) : c));
    setEnding(how);
    setShownId(finalState.sessionId);
    setPhase('done');
  }

  // The interval outlives the render it was created in, so it reads the
  // latest state through refs rather than closing over a stale sitting.
  const latest = useLatest({ state, clock, stage, finish });
  useEffect(() => {
    if (phase !== 'sitting') return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const { state: s, clock: c, stage: st, finish: f } = latest.current;
      // Time's up: the question on screen is dropped unless it was
      // already answered (feedback showing) — nothing after the bell counts.
      if (s && c && isTimeUp(c, budgetSeconds, t)) {
        f(s, s.currentIndex + (st === 'feedback' ? 1 : 0), 'timeUp');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, budgetSeconds, latest]);

  if (!CHECK_PLAN || !exam) {
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

  function handleStart() {
    const dealt = dealCheckSitting(attempts, minutes);
    if (dealt === null) return;
    const t = Date.now();
    const initial: RunnerState = {
      sessionId: crypto.randomUUID(),
      questions: dealt.deck,
      currentIndex: 0,
      correctCount: 0,
      startedAt: t,
      questionShownAt: t,
    };
    startSession(buildSessionStart(initial, CHECK_SUBJECT, CHECK_MODE));
    setPlan(dealt.plan);
    setState(initial);
    setClock(startClock(t));
    setNow(t);
    setEnding('finished');
    setStage('choosing');
    setSelected([]);
    setXpGained(null);
    firstSelectedRef.current = null;
    setPhase('sitting');
  }

  if (phase === 'intro') {
    const last = history[0] ?? null;
    const lastResult = last ? checkResultFor(attempts, last.id) : null;
    const chosen = checkPlanFor(minutes) ?? CHECK_PLAN;
    const domainCount = chosen.perDomain.filter((d) => d.count > 0).length;
    const allDomains = CHECK_PLAN.perDomain.length;
    return (
      <main className="flex flex-col gap-5">
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Readiness check
          </div>
          <h1 className="mt-1 text-2xl font-bold text-ink-900">Could you pass {examName} today?</h1>

          {/* The one choice: how long. The ceiling is the ceiling — there
              is no longer option, and the sitting never runs past it. */}
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              How long do you have?
            </div>
            <div
              className="mt-1.5 flex gap-1 rounded-full bg-ink-100 p-1"
              role="radiogroup"
              aria-label="Time for the check"
              data-testid="check-budget"
            >
              {CHECK_BUDGETS_MINUTES.map((m) => {
                const active = minutes === m;
                const p = checkPlanFor(m);
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-testid={`check-budget-${m}`}
                    onClick={() => setMinutes(m)}
                    className={cn(
                      'tap-feedback flex flex-1 flex-col items-center rounded-full px-2 py-1.5 leading-tight transition-colors',
                      active ? 'bg-surface text-ink-900 shadow-xs' : 'text-ink-600 hover:text-ink-900',
                    )}
                  >
                    <span className="text-sm font-semibold">{m} min</span>
                    <span className="text-[11px] text-ink-500">
                      {p ? `~${p.count} Qs` : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-ink-50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Questions
              </dt>
              <dd className="mt-0.5 text-xl font-bold text-ink-900" data-testid="check-count">
                ~{chosen.count}
              </dd>
            </div>
            <div className="rounded-xl bg-ink-50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Domains
              </dt>
              <dd className="mt-0.5 text-xl font-bold text-ink-900">
                {domainCount < allDomains ? `${domainCount}/${allDomains}` : allDomains}
              </dd>
            </div>
            <div className="rounded-xl bg-ink-50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Pass mark
              </dt>
              <dd className="mt-0.5 text-xl font-bold text-ink-900">{exam.passPct}%</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-ink-600">
            <strong className="font-semibold text-ink-900">A temperature check, not a mock exam:</strong>{' '}
            about {chosen.count} questions at the real exam&apos;s pace, spread across{' '}
            {domainCount < allDomains ? `${domainCount} of the ${allDomains}` : `all ${allDomains}`}{' '}
            domains — more if you&apos;re quicker, fewer if you&apos;re not. The clock stops the
            check at {minutes} min, never later. Questions you haven&apos;t seen come first,
            and you get the answer and explanation after each one, as in practice; what makes
            it a cold look is that each question is asked once.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            At the end: a first read on whether you&apos;d clear the {exam.passPct}% pass line
            today, and which domains to study first — ranked by how much of the exam they
            are and how far below the line you were. Too few questions for a verdict; just
            enough to know where to start.
          </p>
          <Button size="lg" block className="mt-5" onClick={handleStart}>
            <Play className="h-4 w-4" />
            {last ? 'Sit it again' : 'Start the check'}
          </Button>
        </div>

        {last && lastResult ? (
          /* The whole card opens the result; the verdict pill never
             wraps and the score sits beside it, or below on a narrow
             screen — no boxed button squeezed into the corner. */
          <button
            data-testid="check-last"
            onClick={() => {
              setShownId(last.id);
              setPhase('done');
            }}
            className="tap-feedback group flex w-full flex-col gap-2 rounded-2xl border border-ink-200 bg-surface p-4 text-left shadow-xs transition hover:border-brand-300 hover:shadow-md"
          >
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                Last check · {formatDay(last.startedAt)}
              </span>
              <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-brand-600 group-hover:underline">
                See result
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
                  VERDICT_META[lastResult.report.verdict].pill,
                )}
              >
                {VERDICT_META[lastResult.report.verdict].emoji}{' '}
                {VERDICT_META[lastResult.report.verdict].label}
              </span>
              <span className="text-sm tabular-nums text-ink-600">
                <strong className="font-semibold text-ink-900">
                  {lastResult.report.estimatePct}%
                </strong>{' '}
                · {lastResult.correct}/{lastResult.answered} correct
              </span>
            </div>
          </button>
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
    const justSat = state !== null && id === state.sessionId;
    return (
      <main className="flex flex-col gap-5">
        <RunnerCelebrations
          nextUnlock={nextUnlock}
          clearNextUnlock={clearNextUnlock}
          nextLevelUp={nextLevelUp}
          clearNextLevelUp={clearNextLevelUp}
        />
        <BackLink />
        {justSat && ending === 'timeUp' ? (
          <div
            data-testid="check-time-up"
            className="flex items-center gap-3 rounded-2xl border border-warn-500/40 bg-warn-100/60 p-3 text-sm text-ink-700 shadow-xs"
          >
            <Timer className="h-5 w-5 shrink-0 text-warn-700" />
            <span>
              <strong className="font-semibold text-ink-900">Time&apos;s up.</strong> The check
              stopped at {minutes} min with {state.questions.length}{' '}
              {state.questions.length === 1 ? 'question' : 'questions'} answered; the result
              reads over those.
            </span>
          </div>
        ) : null}
        {justSat && ending === 'endedEarly' ? (
          <div
            data-testid="check-ended-early"
            className="flex items-center gap-3 rounded-2xl border border-ink-200 bg-surface p-3 text-sm text-ink-700 shadow-xs"
          >
            <Flag className="h-5 w-5 shrink-0 text-ink-500" />
            <span>
              <strong className="font-semibold text-ink-900">
                Ended early at {state.questions.length}{' '}
                {state.questions.length === 1 ? 'question' : 'questions'}.
              </strong>{' '}
              The result reads over those, with the band that sample size allows.
            </span>
          </div>
        ) : null}
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
              setClock(null);
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

  if (!state || !clock || !plan) return null;

  const current = state.questions[state.currentIndex];
  const multi = isMultiAnswer(current);
  const elapsed = elapsedSeconds(clock, now);
  const remaining = remainingSeconds(clock, budgetSeconds, now);
  // Last minute, or last tenth of a short sitting — the clock turns amber.
  const lowTime = remaining <= Math.max(60, budgetSeconds / 10);
  const answered = state.currentIndex + (stage === 'feedback' ? 1 : 0);
  const deckSize = state.questions.length;
  const pacing = { elapsedSeconds: elapsed, budgetSeconds, answered, deckSize };
  // Once this question is answered, is there time for another? Read
  // live, so the Next button says "See results" as the clock runs down.
  const isLast = stage === 'feedback' && !canDealAnother(pacing);
  // The sitting is time-boxed, so progress is the clock; the projection
  // is only a hint, worded as one, never shown as a total.
  const dealt = state.currentIndex + 1;
  const hint = checkPaceHint({
    answered,
    dealt,
    projected: projectedCheckLength({ ...pacing, dealt, planned: plan.count }),
  });
  // Ending early is open once every domain has the plan's floor — the
  // point the result can say something; before it, the gap in words.
  const gap = checkVerdictGap(
    plan,
    state.questions.slice(0, answered).map((q) => q.categoryKey),
  );

  function handleSelect(key: OptionKey) {
    if (stage !== 'choosing') return;
    firstSelectedRef.current ??= key;
    setSelected((prev) => nextSelection(prev, key, multi));
  }

  function handleCheck() {
    if (!state || !clock || selected.length === 0) return;
    const t = Date.now();
    // The interval only polls once a second, so an answer sent between
    // the bell and the next tick must still be refused.
    if (isTimeUp(clock, budgetSeconds, t)) {
      finish(state, state.currentIndex, 'timeUp');
      return;
    }
    const showXp = progressionEnabled && loadProgressionShown();
    const xpBefore = showXp ? totalXp(loadAttempts()) : 0;
    const attempt = buildAttempt({
      state,
      question: current,
      selected,
      // The question's real category, so readiness and per-category
      // stats see the check as ordinary first attempts.
      categoryKey: current.categoryKey,
      now: t,
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

  /** End the sitting now, over the questions answered — as the bell
   *  would, the question on screen is dropped unless already answered. */
  function handleEndEarly() {
    if (!state || gap > 0) return;
    finish(state, answered, 'endedEarly');
  }

  function handleNext() {
    if (!state || !clock) return;
    const t = Date.now();
    const done = state.currentIndex + 1;
    // Deal another only while the time left holds one at the learner's
    // own pace so far (answer plus feedback); otherwise the sitting ends
    // here, cleanly, with every answered question counted.
    const another = canDealAnother({
      elapsedSeconds: elapsedSeconds(clock, t),
      budgetSeconds,
      answered: done,
      deckSize,
    });
    if (!another) {
      finish(state, done, isTimeUp(clock, budgetSeconds, t) ? 'timeUp' : 'finished');
      return;
    }
    if (lastAttemptRef.current) {
      amendAttempt(lastAttemptRef.current.id, {
        feedbackSeconds: feedbackSecondsSince(lastAttemptRef.current.answeredAt, t),
      });
      lastAttemptRef.current = null;
    }
    firstSelectedRef.current = null;
    setXpGained(null);
    setState(moveToNext(state, t));
    setStage('choosing');
    setSelected([]);
  }

  const timer = (
    <div
      data-testid="check-timer"
      className={cn(
        'flex items-center justify-between gap-3 rounded-2xl border px-3 py-2 shadow-xs',
        lowTime ? 'border-warn-500/40 bg-warn-100/60' : 'border-ink-200 bg-surface',
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <Timer className={cn('h-4.5 w-4.5 shrink-0', lowTime ? 'text-warn-700' : 'text-ink-500')} />
          <span
            data-testid="check-clock"
            className={cn(
              'text-lg font-bold leading-none tabular-nums',
              lowTime ? 'text-warn-700' : 'text-ink-900',
            )}
            aria-live="off"
          >
            {formatClock(remaining)}
          </span>
          <span className="text-xs text-ink-500">left of {minutes} min</span>
        </div>
        <span data-testid="check-hint" className="text-xs text-ink-500">
          {hint}
        </span>
      </div>
      <span className="text-xs text-ink-500">
        {answered} answered
      </span>
    </div>
  );

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
        position={dealt}
        progress={budgetSeconds > 0 ? elapsed / budgetSeconds : 0}
        selected={selected}
        stage={stage}
        onSelect={handleSelect}
        banner={timer}
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
        isLast={isLast}
        onCheck={handleCheck}
        onNext={handleNext}
      />
      {/* Secondary, never the primary button; hidden once Next already
          ends the sitting. */}
      {isLast ? null : (
        <div data-testid="check-end" className="flex flex-col items-center gap-0.5">
          <Button variant="ghost" size="sm" onClick={handleEndEarly} disabled={gap > 0}>
            <Flag className="h-4 w-4" />
            End check
          </Button>
          <span data-testid="check-end-gap" className="text-xs text-ink-500">
            {gap > 0 ? `${gap} more for a verdict` : 'Enough answered for a verdict'}
          </span>
        </div>
      )}
    </main>
  );
}

/** "22 Oct" — the day a past check was sat. */
function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
