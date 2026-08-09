'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Home, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import {
  useRecordAttempt,
  useStartSession,
  useEndSession,
  useStorageData,
} from '@/lib/useStorage';
import { VoteRow } from '@/components/VoteRow';
import { Scratchpad } from '@/components/Scratchpad';
import { SourceRef } from '@/components/SourceRef';
import { McqMarkdown } from '@/components/McqMarkdown';
import { OptionButtons } from '@/pack/OptionButtons';
import { PackImage } from '@/pack/PackImage';
import { ConceptCard } from '@/pack/ConceptCard';
import { QuestionMeta } from '@/pack/QuestionMeta';
import { Celebration } from '@/components/Celebration';
import { useAchievementUnlock } from '@/pack/useAchievementUnlock';
import { loadAttempts, loadSessions, loadLevelFilter } from '@/lib/storage';
import { streakProgress } from '@/lib/stats';
import {
  correctKeysOf,
  isMultiAnswer,
  packQuestions,
  packScenarios,
  PACK_CATEGORY_LABEL,
  PACK_CONCEPT_BY_ID,
  type OptionKey,
} from '@/pack/data';
import {
  advanceAfterAnswer,
  attemptHistory,
  bankForCategory,
  buildAttempt,
  buildSessionEnd,
  buildSessionStart,
  filterByLevel,
  formatKeyList,
  gradeSelection,
  isBankFullySeen,
  isLastQuestion,
  moveToNext,
  nextSelection,
  pickSessionFromBank,
  scoreSummary,
  type RunnerState,
} from './runner';

type Stage = 'choosing' | 'feedback';

interface Props {
  /** Pack category key from the manifest, e.g. 'planets'. */
  categoryKey: string;
}

/**
 * Practice runner for the generic pack variant. Structurally the CCA
 * runner with the pack data source, no achievements engine, and the
 * shared McqMarkdown component instead of a local copy.
 */
export function PackPracticeRunner({ categoryKey }: Props) {
  const { attempts } = useStorageData();
  const recordAttempt = useRecordAttempt();
  const startSession = useStartSession();
  const endSession = useEndSession();
  const { nextUnlock, checkNow, clearNextUnlock } = useAchievementUnlock();

  const [state, setState] = useState<RunnerState | null>(null);
  const [outOfQuestions, setOutOfQuestions] = useState(false);
  // Whether the dealt round is repeats by necessity (every question in the
  // set already attempted) — surfaced once so re-served questions read as
  // deliberate revision, not a broken picker.
  const [repeatRound, setRepeatRound] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>('choosing');
  // The chosen option key(s). Single-answer questions hold one entry;
  // multi-answer ("select all") questions accumulate several.
  const [selected, setSelected] = useState<OptionKey[]>([]);
  const [finished, setFinished] = useState(false);
  // When today's practice goal is reached, the streak length to celebrate
  // (null when there's nothing to show). Distinct from sticker unlocks so a
  // plain day (1-day, 2-day…) still gets a nod, not only milestone days.
  const [streakDone, setStreakDone] = useState<number | null>(null);
  // The active level-band filter (a manifest level key) or null = All.
  // Read from localStorage after mount, so SSR/first paint stay stable.
  const [levelFilter, setLevelFilter] = useState<string | null>(null);

  const bank = useMemo(
    () => filterByLevel(bankForCategory(packQuestions, categoryKey), levelFilter),
    [categoryKey, levelFilter],
  );

  useEffect(() => {
    setMounted(true);
    setLevelFilter(loadLevelFilter());
  }, []);

  // Pick a session after mount (so localStorage attempts are reflected),
  // and again whenever `state` is cleared — that's how "Another round"
  // restarts: it sets state to null and relies on this effect re-running
  // to deal a fresh round. `state` must stay in the deps or the restart
  // hangs on the "Loading…" placeholder forever.
  useEffect(() => {
    if (!mounted || state) return;
    const history = attemptHistory(attempts, categoryKey);
    const picked = pickSessionFromBank(bank, history);
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
    };
    startSession(buildSessionStart(initial, categoryKey));
    setState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, bank, categoryKey, state]);

  if (outOfQuestions) {
    return (
      <main className="flex flex-col gap-5">
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-ink-900">
            No {PACK_CATEGORY_LABEL[categoryKey] ?? categoryKey} questions yet
          </h1>
          <p className="mt-2 text-ink-600">
            This pack has no questions for this category yet.
          </p>
          <Link href="/" className="mt-4 inline-block">
            <Button size="lg">Back to home</Button>
          </Link>
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex flex-col gap-5">
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 text-center text-ink-500 shadow-sm">
          Loading…
        </div>
      </main>
    );
  }

  if (finished) {
    const { correct, total, pct } = scoreSummary(state);
    return (
      <main className="flex flex-col gap-5">
        {nextUnlock ? (
          <Celebration achievement={nextUnlock} onDone={clearNextUnlock} />
        ) : null}
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-8 text-center shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Practice complete
          </div>
          <h1 className="mt-2 text-4xl font-bold text-ink-900">
            {correct}/{total}
          </h1>
          <p className="mt-1 text-lg font-medium text-ink-600">
            {pct}% correct
          </p>
          <p className="mt-4 text-sm text-ink-500">
            {PACK_CATEGORY_LABEL[categoryKey] ?? categoryKey}
          </p>
          <div className="mt-6 flex flex-col gap-2">
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
          </div>
        </div>
      </main>
    );
  }

  const current = state.questions[state.currentIndex];
  const scenario = current.scenarioId
    ? packScenarios.find((s) => s.id === current.scenarioId)
    : undefined;
  // Only show the scenario card when there's a real shared stem —
  // see the CCA runner for the rationale.
  const scenarioWithStem =
    scenario && scenario.stem ? { ...scenario, stem: scenario.stem } : null;

  const multi = isMultiAnswer(current);

  function handleSelect(key: OptionKey) {
    if (stage !== 'choosing') return;
    setSelected((prev) => nextSelection(prev, key, multi));
  }

  function handleCheck() {
    if (!state || selected.length === 0) return;
    const attempt = buildAttempt({
      state,
      question: current,
      selected,
      categoryKey,
      now: Date.now(),
      attemptId: crypto.randomUUID(),
    });
    recordAttempt(attempt);
    // Achievements evaluate against what's now persisted — re-read so
    // this can't race the useStorageData snapshot.
    const freshAttempts = loadAttempts();
    const unlocked = checkNow(loadSessions(), freshAttempts);
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
    if (isLastQuestion(state)) {
      endSession(buildSessionEnd(state, categoryKey, Date.now()));
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

  const isCorrect = stage === 'feedback' && gradeSelection(current, selected);
  const answerKeys = correctKeysOf(current);
  const concept = current.conceptId ? PACK_CONCEPT_BY_ID[current.conceptId] : undefined;

  return (
    <main className="flex flex-col gap-5">
      {nextUnlock ? (
        <Celebration achievement={nextUnlock} onDone={clearNextUnlock} />
      ) : streakDone !== null ? (
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
      ) : null}
      <header className="flex items-center justify-between">
        <BackLink />
        <ProgressBar
          current={state.currentIndex + 1}
          total={state.questions.length}
        />
      </header>

      {repeatRound && state.currentIndex === 0 ? (
        <div
          data-testid="repeat-round-banner"
          className="flex items-center gap-3 rounded-2xl border border-brand-500/30 bg-brand-50 p-3 shadow-sm"
        >
          <RefreshCw className="h-4 w-4 flex-shrink-0 text-brand-600" />
          <p className="text-sm text-ink-700">
            You&apos;ve answered every question in this set — this round
            revisits your mistakes and the ones you&apos;ve not seen for
            longest.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <QuestionMeta question={current} />
        {scenario ? (
          <span className="rounded-full border border-ink-300 bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-700">
            {scenario.title}
          </span>
        ) : null}
        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-600">
          Q {state.currentIndex + 1} / {state.questions.length}
        </span>
      </div>

      {scenarioWithStem ? (
        <section className="rounded-2xl border border-ink-200 bg-ink-50/60 p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Scenario
          </div>
          <div className="mt-0.5 text-base font-semibold text-ink-900">
            {scenarioWithStem.title}
          </div>
          <div className="mt-2 text-[15px] leading-relaxed text-ink-800">
            <McqMarkdown text={scenarioWithStem.stem} />
          </div>
        </section>
      ) : null}

      <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
        <div className="text-[15px] leading-relaxed text-ink-900">
          <McqMarkdown text={current.prompt} />
        </div>
      </div>

      {current.image ? (
        <div className="flex justify-center rounded-2xl border border-ink-200 bg-surface p-4 shadow-sm">
          <PackImage
            src={current.image}
            alt=""
            className="max-h-72 w-auto object-contain"
          />
        </div>
      ) : null}

      <Scratchpad />

      {multi ? (
        <div className="-mb-1 flex items-center gap-1.5 text-xs font-semibold text-brand-700">
          <ListChecks className="h-4 w-4" />
          Select all that apply
        </div>
      ) : null}

      <OptionButtons
        options={current.options}
        selected={selected}
        stage={stage}
        correctKeys={answerKeys}
        multi={multi}
        onSelect={handleSelect}
      />

      {stage === 'choosing' ? (
        <Button
          size="lg"
          block
          onClick={handleCheck}
          disabled={selected.length === 0}
        >
          Check answer
        </Button>
      ) : (
        <div
          className={cn(
            'flex flex-col gap-3 rounded-2xl border p-4',
            isCorrect
              ? 'border-success-500/30 bg-success-100/60'
              : 'border-warn-500/30 bg-warn-100/60',
          )}
        >
          <div
            className={cn(
              'text-lg font-bold',
              isCorrect ? 'text-success-700' : 'text-warn-700',
            )}
          >
            {isCorrect ? 'Correct.' : 'Not quite.'}
          </div>
          {!isCorrect ? (
            <div className="text-[15px] text-ink-700">
              {answerKeys.length > 1 ? 'The answers are ' : 'The answer is '}
              <span className="font-semibold text-ink-900">
                {formatKeyList(answerKeys)}
              </span>
              .
            </div>
          ) : null}
          <div className="text-[15px] leading-relaxed text-ink-800">
            <McqMarkdown text={current.explanation} />
          </div>
          {concept ? (
            <ConceptCard concept={concept} defaultOpen={!isCorrect} />
          ) : null}
          <SourceRef sourceRef={current.sourceRef} />
          <VoteRow questionId={current.id} />
          <Button size="lg" block onClick={handleNext} className="mt-1">
            {state.currentIndex + 1 === state.questions.length
              ? 'See results'
              : 'Next question'}
          </Button>
        </div>
      )}
    </main>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
    >
      <ArrowLeft className="h-4 w-4" />
      Home
    </Link>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round((current / total) * 100);
  return (
    <div className="flex w-32 items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full bg-brand-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-ink-500">
        {current}/{total}
      </span>
    </div>
  );
}
