'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import {
  useRecordAttempt,
  useStartSession,
  useEndSession,
} from '@/lib/useStorage';
import { VoteRow } from '@/components/VoteRow';
import { StarButton } from '@/components/StarButton';
import { Scratchpad } from '@/components/Scratchpad';
import { SourceRef } from '@/components/SourceRef';
import { McqMarkdown } from '@/components/McqMarkdown';
import { OptionButtons } from '@/pack/OptionButtons';
import { PackImage } from '@/pack/PackImage';
import { ConceptCard } from '@/pack/ConceptCard';
import { QuestionMeta } from '@/pack/QuestionMeta';
import { Celebration } from '@/components/Celebration';
import { useAchievementUnlock } from '@/pack/useAchievementUnlock';
import { loadAttempts, loadSessions } from '@/lib/storage';
import {
  packScenarios,
  PACK_CONCEPT_BY_ID,
  type OptionKey,
  type PackQuestion,
} from '@/pack/data';
import {
  advanceAfterAnswer,
  buildAttempt,
  buildSessionEnd,
  buildSessionStart,
  isLastQuestion,
  moveToNext,
  scoreSummary,
  type RunnerState,
} from './runner';

type Stage = 'choosing' | 'feedback';

interface Props {
  /** The pre-picked follow-up questions for this round. */
  questions: PackQuestion[];
  /** Start a fresh round (re-pick from the related-topic bank). */
  onRestart: () => void;
  /** Leave practice and return to the Starred page. */
  onExit: () => void;
}

/**
 * Follow-up practice over the topics behind the learner's starred
 * questions (see runner.relatedTopicBank). Same practice loop as the main
 * runner, but seeded with a fixed question list the Starred page picked.
 * Attempts are recorded as ordinary practice, so they still feed stats,
 * stickers, and the mistakes queue.
 */
export function StarredRunner({ questions, onRestart, onExit }: Props) {
  const recordAttempt = useRecordAttempt();
  const startSession = useStartSession();
  const endSession = useEndSession();
  const { nextUnlock, checkNow, clearNextUnlock } = useAchievementUnlock();

  const [state, setState] = useState<RunnerState>(() => ({
    sessionId: crypto.randomUUID(),
    questions,
    currentIndex: 0,
    correctCount: 0,
    startedAt: Date.now(),
  }));
  const [stage, setStage] = useState<Stage>('choosing');
  const [selected, setSelected] = useState<OptionKey | null>(null);
  const [finished, setFinished] = useState(false);

  // Persist the "session started" record once, after mount — never in the
  // state initializer, which StrictMode runs twice (two phantom sessions).
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startSession(buildSessionStart(state, questions[0].categoryKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (finished) {
    const { correct, total, pct } = scoreSummary(state);
    return (
      <main className="flex flex-col gap-5">
        {nextUnlock ? (
          <Celebration achievement={nextUnlock} onDone={clearNextUnlock} />
        ) : null}
        <div className="rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Follow-up complete
          </div>
          <h1 className="mt-2 text-4xl font-bold text-ink-900">
            {correct}/{total}
          </h1>
          <p className="mt-1 text-lg font-medium text-ink-600">{pct}% correct</p>
          <p className="mt-4 text-sm text-ink-500">
            Extra practice on the topics you starred.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button size="lg" block onClick={onRestart}>
              <RefreshCw className="h-4 w-4" />
              Another round
            </Button>
            <Button size="lg" variant="secondary" block onClick={onExit}>
              <Home className="h-4 w-4" />
              Back to starred
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const current = state.questions[state.currentIndex];
  const scenario = current.scenarioId
    ? packScenarios.find((s) => s.id === current.scenarioId)
    : undefined;
  const scenarioWithStem =
    scenario && scenario.stem ? { ...scenario, stem: scenario.stem } : null;

  function handleSelect(key: OptionKey) {
    if (stage !== 'choosing') return;
    setSelected(key);
  }

  function handleCheck() {
    if (selected === null) return;
    const attempt = buildAttempt({
      state,
      question: current,
      selected,
      categoryKey: current.categoryKey,
      now: Date.now(),
      attemptId: crypto.randomUUID(),
    });
    recordAttempt(attempt);
    checkNow(loadSessions(), loadAttempts());
    setState(advanceAfterAnswer(state, attempt.isCorrect));
    setStage('feedback');
  }

  function handleNext() {
    if (isLastQuestion(state)) {
      endSession(buildSessionEnd(state, state.questions[0].categoryKey, Date.now()));
      checkNow(loadSessions(), loadAttempts());
      setFinished(true);
      return;
    }
    setState(moveToNext(state));
    setStage('choosing');
    setSelected(null);
  }

  const isCorrect = stage === 'feedback' && selected === current.correctKey;
  const concept = current.conceptId ? PACK_CONCEPT_BY_ID[current.conceptId] : undefined;

  return (
    <main className="flex flex-col gap-5">
      {nextUnlock ? (
        <Celebration achievement={nextUnlock} onDone={clearNextUnlock} />
      ) : null}
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={onExit}
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          Exit
        </button>
        <ProgressBar
          current={state.currentIndex + 1}
          total={state.questions.length}
        />
      </header>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="rounded-full border border-brand-500/50 bg-brand-100/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700">
          Follow-up
        </span>
        <QuestionMeta question={current} />
        {scenario ? (
          <span className="rounded-full border border-ink-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-700">
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

      <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm">
        <div className="text-[15px] leading-relaxed text-ink-900">
          <McqMarkdown text={current.prompt} />
        </div>
      </div>

      {current.image ? (
        <div className="flex justify-center rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
          <PackImage
            src={current.image}
            alt=""
            className="max-h-72 w-auto object-contain"
          />
        </div>
      ) : null}

      <Scratchpad />

      <OptionButtons
        options={current.options}
        selected={selected}
        stage={stage}
        correctKey={current.correctKey}
        onSelect={handleSelect}
      />

      {stage === 'choosing' ? (
        <Button size="lg" block onClick={handleCheck} disabled={selected === null}>
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
              The answer is{' '}
              <span className="font-semibold text-ink-900">{current.correctKey}</span>.
            </div>
          ) : null}
          <div className="text-[15px] leading-relaxed text-ink-800">
            <McqMarkdown text={current.explanation} />
          </div>
          {concept ? (
            <ConceptCard concept={concept} defaultOpen={!isCorrect} />
          ) : null}
          <SourceRef sourceRef={current.sourceRef} />
          <StarButton questionId={current.id} />
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
