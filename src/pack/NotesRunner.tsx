'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Home, ListChecks, NotebookPen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import {
  useRecordAttempt,
  useStartSession,
  useEndSession,
} from '@/lib/useStorage';
import { VoteRow } from '@/components/VoteRow';
import { NoteRow } from '@/components/NoteRow';
import { NoteOrigin } from '@/pack/NoteOrigin';
import { Scratchpad } from '@/components/Scratchpad';
import { SourceRef } from '@/components/SourceRef';
import { McqMarkdown } from '@/components/McqMarkdown';
import { OptionButtons } from '@/pack/OptionButtons';
import { PackImage } from '@/pack/PackImage';
import { ConceptCard } from '@/pack/ConceptCard';
import { QuestionMeta } from '@/pack/QuestionMeta';
import { Celebration } from '@/components/Celebration';
import { useAchievementUnlock } from '@/pack/useAchievementUnlock';
import { amendAttempt, loadAttempts, loadNotes, loadSessions } from '@/lib/storage';
import { notesPracticePool } from '@/pack/notes-practice';
import {
  correctKeysOf,
  isMultiAnswer,
  packQuestions,
  packScenarios,
  PACK_CONCEPT_BY_ID,
  type OptionKey,
} from '@/pack/data';
import {
  advanceAfterAnswer,
  buildAttempt,
  buildSessionEnd,
  buildSessionStart,
  feedbackSecondsSince,
  formatKeyList,
  gradeSelection,
  isLastQuestion,
  moveToNext,
  nextSelection,
  scoreSummary,
  type RunnerState,
} from './runner';

type Stage = 'choosing' | 'feedback';

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

  const [state, setState] = useState<RunnerState | null>(null);
  const [nothingToPractice, setNothingToPractice] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>('choosing');
  const [selected, setSelected] = useState<OptionKey[]>([]);
  // First option tapped on the current question (first-instinct signal)
  // and the just-recorded attempt (to stamp feedbackSeconds on Next).
  const firstSelectedRef = useRef<OptionKey | null>(null);
  const lastAttemptRef = useRef<{ id: string; answeredAt: number } | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => setMounted(true), []);

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

  if (nothingToPractice) {
    return (
      <main className="flex flex-col gap-5">
        <BackLink />
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 text-center shadow-sm">
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
            Notes round complete
          </div>
          <h1 className="mt-2 text-4xl font-bold text-ink-900">
            {correct}/{total}
          </h1>
          <p className="mt-1 text-lg font-medium text-ink-600">{pct}% correct</p>
          <p className="mt-4 text-sm text-ink-500">
            These were the questions around your notes — the ones you flagged
            and the follow-ups generated from them.
          </p>
          <div className="mt-6 flex flex-col gap-2">
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

  const multi = isMultiAnswer(current);

  function handleSelect(key: OptionKey) {
    if (stage !== 'choosing') return;
    firstSelectedRef.current ??= key;
    setSelected((prev) => nextSelection(prev, key, multi));
  }

  function handleCheck() {
    if (!state || selected.length === 0) return;
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
    checkNow(loadSessions(), loadAttempts());
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

  const isCorrect = stage === 'feedback' && gradeSelection(current, selected);
  const answerKeys = correctKeysOf(current);
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
        <span className="rounded-full border border-brand-500/50 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700">
          From your notes
        </span>
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
          <NoteOrigin generatedFrom={current.generatedFrom} />
          {/* keyed so per-question draft state resets when the question advances */}
          <VoteRow key={`vote-${current.id}`} questionId={current.id} />
          <NoteRow key={`note-${current.id}`} questionId={current.id} />
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
      href="/notes/"
      className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
    >
      <ArrowLeft className="h-4 w-4" />
      My notes
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
