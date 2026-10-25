'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Home, Pause, Play, RefreshCw, Timer } from 'lucide-react';
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
  BackLink,
  ProgressBar,
  QuestionPanel,
  RunnerCelebrations,
  RunnerResults,
} from '@/pack/RunnerPanels';
import { loadAttempts, loadSessions } from '@/lib/storage';
import { sessionMistakeIds } from '@/lib/mistakes';
import { cn } from '@/lib/cn';
import {
  elapsedSeconds,
  formatClock,
  isPaused,
  isTimeUp,
  pauseClock,
  remainingSeconds,
  resumeClock,
  startClock,
  type ExamClock,
} from '@/lib/examClock';
import { PACK_LEVEL_LABEL, type OptionKey, isMultiAnswer } from '@/pack/data';
import { EXAM_SITTING, passed } from '@/pack/exam';
import {
  advanceAfterAnswer,
  attemptHistory,
  buildAttempt,
  buildSessionEnd,
  buildSessionStart,
  isLastQuestion,
  moveToNext,
  nextSelection,
  pickSessionFromBank,
  scoreSummary,
  type RunnerState,
} from './runner';

/** Session pseudo-subject; attempts keep their real category key. */
const EXAM_SUBJECT = 'exam';

type Phase =
  | 'intro' // the rules and the Start button — the clock hasn't started
  | 'sitting' // questions under the clock
  | 'done'; // results

type Ending = 'finished' | 'timeUp';

/**
 * Timed exam runner: one sitting at the pack's declared exam pace (see
 * src/pack/exam.ts), dealt from the hardest level. Unlike practice there
 * is no feedback between questions — the verdict comes at the end, as
 * in the real thing — and the countdown can be paused, which hides the
 * question so a pause can't be free thinking time. Attempts record as
 * mode 'exam' with each question's real category, so readiness,
 * mistakes and XP all see them; the session carries the 'exam'
 * pseudo-subject. Celebrations are held back until the results screen.
 */
export function PackExamRunner() {
  const sitting = EXAM_SITTING;
  const exam = APP_CONFIG.exam;
  const { attempts } = useStorageData();
  const recordAttempt = useRecordAttempt();
  const startSession = useStartSession();
  const endSession = useEndSession();
  const { nextUnlock, checkNow, clearNextUnlock } = useAchievementUnlock();
  const { nextLevelUp, checkNow: checkLevelNow, clearNextLevelUp } = useLevelUp();

  const [phase, setPhase] = useState<Phase>('intro');
  const [ending, setEnding] = useState<Ending>('finished');
  const [state, setState] = useState<RunnerState | null>(null);
  const [clock, setClock] = useState<ExamClock | null>(null);
  // Re-read once a second while sitting so the countdown moves; the clock
  // itself is a pure value over Date.now() (src/lib/examClock.ts).
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<OptionKey[]>([]);
  // First option tapped on the current question (first-instinct signal).
  const firstSelectedRef = useRef<OptionKey | null>(null);

  function finish(finalState: RunnerState, how: Ending) {
    const t = Date.now();
    endSession(buildSessionEnd(finalState, EXAM_SUBJECT, t, 'exam'));
    // Session-shaped stickers (first session, flawless round) can only
    // unlock once the end record is written.
    checkNow(loadSessions(), loadAttempts());
    setState(finalState);
    // Freeze the clock so the results screen reports the time used at
    // the finish, however long it then stays open.
    setClock((c) => (c ? pauseClock(c, t) : c));
    setEnding(how);
    setPhase('done');
  }

  // The interval outlives the render it was created in, so it reads the
  // latest state through refs rather than closing over a stale sitting.
  const latest = useLatest({ state, clock, finish });
  useEffect(() => {
    if (phase !== 'sitting' || !sitting) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const { state: s, clock: c, finish: f } = latest.current;
      if (s && c && isTimeUp(c, sitting.durationSeconds, t)) f(s, 'timeUp');
    }, 1000);
    return () => clearInterval(id);
  }, [phase, sitting, latest]);

  if (!sitting || !exam) {
    return (
      <main className="flex flex-col gap-5">
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 text-center shadow-xs">
          <h1 className="text-2xl font-bold text-ink-900">No timed exam in this pack</h1>
          <p className="mt-2 text-ink-600">
            This pack doesn&apos;t declare an exam length, or holds too few questions
            for a real sitting, so there&apos;s nothing to sit against the clock.
          </p>
          <Link href="/" className="mt-4 inline-block">
            <Button size="lg">Back to home</Button>
          </Link>
        </div>
      </main>
    );
  }

  const examName = exam.label ?? 'Timed exam';
  const duration = formatClock(sitting.durationSeconds);

  function handleStart() {
    if (!sitting) return;
    const picked = pickSessionFromBank(
      sitting.bank,
      attemptHistory(attempts),
      undefined,
      sitting.count,
    );
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
    startSession(buildSessionStart(initial, EXAM_SUBJECT, 'exam'));
    setState(initial);
    setClock(startClock(t));
    setNow(t);
    setSelected([]);
    firstSelectedRef.current = null;
    setPhase('sitting');
  }

  if (phase === 'intro') {
    const from = sitting.level ? PACK_LEVEL_LABEL[sitting.level] : null;
    return (
      <main className="flex flex-col gap-5">
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Timed exam
          </div>
          <h1 className="mt-1 text-2xl font-bold text-ink-900">{examName}</h1>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-ink-50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Questions
              </dt>
              <dd className="mt-0.5 text-xl font-bold text-ink-900">{sitting.count}</dd>
            </div>
            <div className="rounded-xl bg-ink-50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                On the clock
              </dt>
              <dd className="mt-0.5 text-xl font-bold tabular-nums text-ink-900">{duration}</dd>
            </div>
            <div className="rounded-xl bg-ink-50 p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Pass mark
              </dt>
              <dd className="mt-0.5 text-xl font-bold text-ink-900">{exam.passPct}%</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm leading-relaxed text-ink-600">
            {sitting.count} questions{from ? ` from the ${from} set` : ''}, at the real
            exam&apos;s pace. No answers or explanations until the end — then
            your score against the {exam.passPct}% pass mark, and a review of
            the questions you got wrong.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            You can pause the clock; the question is hidden while paused.
          </p>
          <Button size="lg" block className="mt-5" onClick={handleStart}>
            <Play className="h-4 w-4" />
            Start exam
          </Button>
        </div>
      </main>
    );
  }

  if (!state || !clock) return null;

  if (phase === 'done') {
    const score = scoreSummary(state);
    const ok = passed(exam, score);
    const mistakes = sessionMistakeIds(attempts, state.sessionId).length;
    const unanswered =
      state.questions.length - attempts.filter((a) => a.sessionId === state.sessionId).length;
    // The clock was frozen at the finish, so `now` is moot here.
    const used = formatClock(Math.min(elapsedSeconds(clock, now), sitting.durationSeconds));
    return (
      <RunnerResults
        eyebrow={ending === 'timeUp' ? "Time's up" : 'Exam complete'}
        score={score}
        note={
          <span className="flex flex-col items-center gap-2">
            <span
              data-testid="exam-verdict"
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider',
                ok ? 'bg-success-100 text-success-700' : 'bg-warn-100 text-warn-700',
              )}
            >
              {ok ? 'Passed' : 'Not passed'} · pass mark {exam.passPct}%
            </span>
            <span>
              {examName} · {used} of {duration} used
              {unanswered > 0 ? ` · ${unanswered} unanswered` : ''}
            </span>
            {unanswered > 0 ? (
              // Unreached questions count as wrong in the score but were
              // never shown, so they are not attempts and not mistakes:
              // the review below covers only what was answered.
              <span className="text-xs text-ink-400">
                Questions that weren&apos;t reached count as wrong but aren&apos;t in
                your mistakes — sit again to get to them.
              </span>
            ) : null}
            {exam.scaled ? (
              <span className="text-xs text-ink-400">
                The real exam is scored on a scaled curve — treat the pass mark as approximate.
              </span>
            ) : null}
          </span>
        }
        celebrations={
          <RunnerCelebrations
            nextUnlock={nextUnlock}
            clearNextUnlock={clearNextUnlock}
            nextLevelUp={nextLevelUp}
            clearNextLevelUp={clearNextLevelUp}
          />
        }
      >
        {mistakes > 0 ? (
          <Link href={`/practice/review/#session=${state.sessionId}`} className="block">
            <Button size="lg" block>
              <RefreshCw className="h-4 w-4" />
              Review {mistakes} {mistakes === 1 ? 'mistake' : 'mistakes'} from this sitting
            </Button>
          </Link>
        ) : null}
        <Button
          size="lg"
          variant={mistakes > 0 ? 'secondary' : 'primary'}
          block
          onClick={() => {
            setState(null);
            setClock(null);
            setPhase('intro');
          }}
        >
          <Timer className="h-4 w-4" />
          Sit again
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
  const paused = isPaused(clock);
  const remaining = remainingSeconds(clock, sitting.durationSeconds, now);
  const elapsed = elapsedSeconds(clock, now);
  // Last minute, or last tenth of a short sitting — the clock turns amber.
  const lowTime = remaining <= Math.max(60, sitting.durationSeconds / 10);

  function handleSelect(key: OptionKey) {
    if (paused) return;
    firstSelectedRef.current ??= key;
    setSelected((prev) => nextSelection(prev, key, multi));
  }

  function handlePause() {
    if (!clock) return;
    const t = Date.now();
    setClock(pauseClock(clock, t));
    setNow(t);
  }

  function handleResume() {
    if (!clock || !state || clock.pausedAt === null) return;
    const t = Date.now();
    // The question's own timer skips the pause too, so timeTakenSeconds
    // measures thinking time, not the break.
    setState({ ...state, questionShownAt: state.questionShownAt + (t - clock.pausedAt) });
    setClock(resumeClock(clock, t));
    setNow(t);
  }

  function handleNext() {
    if (!state || !clock || !sitting || selected.length === 0 || paused) return;
    const t = Date.now();
    // The interval only polls once a second (and the browser may throttle
    // it further), so an answer sent between the bell and the next tick
    // must still be refused: nothing after the deadline counts.
    if (isTimeUp(clock, sitting.durationSeconds, t)) {
      finish(state, 'timeUp');
      return;
    }
    const attempt = buildAttempt({
      state,
      question: current,
      selected,
      // Persist the question's actual category so per-category stats and
      // readiness stay accurate across the mixed sitting.
      categoryKey: current.categoryKey,
      now: t,
      attemptId: crypto.randomUUID(),
      mode: 'exam',
      firstSelected: firstSelectedRef.current ?? undefined,
    });
    recordAttempt(attempt);
    // Achievements evaluate against what's now persisted — re-read so
    // this can't race the useStorageData snapshot. Toasts queue silently
    // until the results screen.
    const freshAttempts = loadAttempts();
    checkNow(loadSessions(), freshAttempts);
    checkLevelNow(freshAttempts);
    firstSelectedRef.current = null;
    setSelected([]);
    const next = advanceAfterAnswer(state, attempt.isCorrect);
    if (isLastQuestion(state)) {
      finish(next, 'finished');
      return;
    }
    setState(moveToNext(next));
  }

  const timer = (
    <div
      data-testid="exam-timer"
      className={cn(
        'flex items-center justify-between gap-3 rounded-2xl border p-3 shadow-xs',
        lowTime ? 'border-warn-500/40 bg-warn-100/60' : 'border-ink-200 bg-surface',
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            lowTime ? 'bg-warn-500/20 text-warn-700' : 'bg-ink-100 text-ink-700',
          )}
        >
          <Timer className="h-5 w-5" />
        </div>
        <div>
          <div
            data-testid="exam-clock"
            className={cn(
              'text-2xl font-bold leading-none tabular-nums',
              lowTime ? 'text-warn-700' : 'text-ink-900',
            )}
            aria-live="off"
          >
            {formatClock(remaining)}
          </div>
          <div className="mt-1 text-xs text-ink-500">
            {paused ? 'Paused' : `Used ${formatClock(elapsed)} of ${duration}`}
          </div>
        </div>
      </div>
      {paused ? (
        <Button size="sm" onClick={handleResume}>
          <Play className="h-4 w-4" />
          Resume
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={handlePause}>
          <Pause className="h-4 w-4" />
          Pause
        </Button>
      )}
    </div>
  );

  if (paused) {
    return (
      <main className="flex flex-col gap-5">
        <header className="flex items-center justify-between">
          <BackLink />
          <ProgressBar current={state.currentIndex + 1} total={state.questions.length} />
        </header>
        {timer}
        <div
          data-testid="exam-paused"
          className="rounded-2xl border border-ink-200 bg-surface p-8 text-center shadow-xs"
        >
          <Pause className="mx-auto h-8 w-8 text-ink-400" />
          <h1 className="mt-3 text-2xl font-bold text-ink-900">Paused</h1>
          <p className="mt-2 text-ink-600">
            The clock has stopped and the question is hidden. Resume when you&apos;re
            ready — your answers so far are kept.
          </p>
          <Button size="lg" className="mt-5" onClick={handleResume}>
            <Play className="h-4 w-4" />
            Resume
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-5">
      <QuestionPanel
        question={current}
        position={state.currentIndex + 1}
        total={state.questions.length}
        selected={selected}
        stage="choosing"
        onSelect={handleSelect}
        banner={timer}
        badge={
          <span className="rounded-full border border-ink-400/40 bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-700">
            {examName}
          </span>
        }
      />
      <Button size="lg" block onClick={handleNext} disabled={selected.length === 0}>
        {isLastQuestion(state) ? 'Finish exam' : 'Next question'}
      </Button>
    </main>
  );
}
