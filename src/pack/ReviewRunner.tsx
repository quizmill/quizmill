'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import {
  useRecordAttempt,
  useStartSession,
  useEndSession,
  useStorageData,
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
import { unresolvedMistakeIds } from '@/lib/mistakes';
import {
  packQuestions,
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

const REVIEW_BATCH_SIZE = 10;

type Stage = 'choosing' | 'feedback';

/**
 * Review-mode runner for the pack variant: re-asks questions the user
 * got wrong and hasn't since rescued. Same structure as the CCA
 * ReviewRunner (including the mount-race guard — see the comment
 * there) over the pack data source.
 */
export function PackReviewRunner() {
  const { attempts } = useStorageData();
  const recordAttempt = useRecordAttempt();
  const startSession = useStartSession();
  const endSession = useEndSession();
  const { nextUnlock, checkNow, clearNextUnlock } = useAchievementUnlock();

  const [state, setState] = useState<RunnerState | null>(null);
  const [nothingToReview, setNothingToReview] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>('choosing');
  const [selected, setSelected] = useState<OptionKey | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || state) return;
    const ids = unresolvedMistakeIds(attempts).slice(0, REVIEW_BATCH_SIZE);
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
    };
    startSession(buildSessionStart(initial, picked[0].categoryKey, 'review'));
    setState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, attempts]);

  if (nothingToReview) {
    return (
      <main className="flex flex-col gap-5">
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-ink-900">
            Nothing to review
          </h1>
          <p className="mt-2 text-ink-600">
            You haven't got any unresolved mistakes right now. Keep
            practising — questions you get wrong show up here so you can
            retry them.
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
        <div className="rounded-2xl border border-ink-200 bg-white p-6 text-center text-ink-500 shadow-sm">
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
        <div className="rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-sm">
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
            <Link href="/practice/review/" className="block">
              <Button size="lg" block>
                <RefreshCw className="h-4 w-4" />
                Review more
              </Button>
            </Link>
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
  const scenarioWithStem =
    scenario && scenario.stem ? { ...scenario, stem: scenario.stem } : null;

  function handleSelect(key: OptionKey) {
    if (stage !== 'choosing') return;
    setSelected(key);
  }

  function handleCheck() {
    if (!state || selected === null) return;
    const attempt = buildAttempt({
      state,
      question: current,
      selected,
      // Persist the question's actual category so per-category stats
      // stay accurate across a mixed review session.
      categoryKey: current.categoryKey,
      now: Date.now(),
      attemptId: crypto.randomUUID(),
    });
    recordAttempt(attempt);
    // Same re-read rationale as the practice runner — see there.
    checkNow(loadSessions(), loadAttempts());
    setState(advanceAfterAnswer(state, attempt.isCorrect));
    setStage('feedback');
  }

  function handleNext() {
    if (!state) return;
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
        <BackLink />
        <ProgressBar
          current={state.currentIndex + 1}
          total={state.questions.length}
        />
      </header>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="rounded-full border border-warn-500/50 bg-warn-100/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warn-700">
          Review mistakes
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
        <Button
          size="lg"
          block
          onClick={handleCheck}
          disabled={selected === null}
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
            {isCorrect ? 'Rescued.' : "We'll bring this one back later."}
          </div>
          {!isCorrect ? (
            <div className="text-[15px] text-ink-700">
              The answer is{' '}
              <span className="font-semibold text-ink-900">
                {current.correctKey}
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
