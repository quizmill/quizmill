'use client';

import { useState } from 'react';
import { ClipboardCheck, ListChecks, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { McqMarkdown } from '@/components/McqMarkdown';
import { SourceRef } from '@/components/SourceRef';
import { VoteRow } from '@/components/VoteRow';
import { useMounted } from '@/lib/useMounted';
import { APP_CONFIG } from '@/config';
import { ConceptCard } from '@/pack/ConceptCard';
import { MatchRows } from '@/pack/MatchRows';
import { NoteOrigin } from '@/pack/NoteOrigin';
import { OptionButtons } from '@/pack/OptionButtons';
import { PackImage } from '@/pack/PackImage';
import { QuestionMeta } from '@/pack/QuestionMeta';
import { BackLink } from '@/pack/RunnerPanels';
import {
  answerKeysOf,
  correctKeysOf,
  isMatching,
  isMultiAnswer,
  packQuestions,
  packScenarios,
  PACK_CONCEPT_BY_ID,
  type PackQuestion,
} from '@/pack/data';
import {
  drawReviewSample,
  REVIEW_BATCH_SIZES,
  type ReviewBatchSize,
  type ReviewDraw,
} from '@/pack/review-sample';

const DEFAULT_SIZE: ReviewBatchSize = 10;

/** Nothing is selected: every option renders in its resting feedback
 *  state and the right one(s) light up. */
const noop = () => {};

const REVIEW_STATUS_TONE: Record<PackQuestion['reviewStatus'], string> = {
  draft: 'border-warn-500/40 bg-warn-100 text-warn-700',
  reviewed: 'border-ink-300 bg-surface text-ink-700',
  approved: 'border-success-500/40 bg-success-100 text-success-700',
};

/**
 * The pack review page (Settings → Packs → Review questions): a random
 * handful of the active pack's questions, each shown answered — the right
 * option(s) lit, every per-option note and the full explanation open, and
 * all the metadata a learner never sees (id, review status, difficulty,
 * source). For the pack's author to judge the bank's quality without
 * practising it: nothing here is recorded as an attempt. The thumbs are
 * the ordinary question votes, so a flagged question lands in the
 * "Question feedback" browser in Settings like one flagged mid-practice.
 *
 * "Draw again" walks the whole bank before anything repeats; the seen set
 * lives in memory and resets when the page is left.
 */
export function PackReviewPage() {
  const mounted = useMounted();
  const [size, setSize] = useState<ReviewBatchSize>(DEFAULT_SIZE);
  // The first draw happens in the initialiser (random, so never part of
  // the prerendered HTML — the list is gated on `mounted` below).
  const [draw, setDraw] = useState<ReviewDraw<PackQuestion>>(() =>
    drawReviewSample(packQuestions, { size: DEFAULT_SIZE }),
  );

  function redraw(nextSize: ReviewBatchSize) {
    setSize(nextSize);
    setDraw((d) => drawReviewSample(packQuestions, { size: nextSize, seen: d.seen }));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  const total = packQuestions.length;
  const seenCount = draw.seen.size;

  return (
    <main className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <BackLink href="/settings/" label="Settings" />
      </header>

      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-ink-900">
          <ClipboardCheck className="h-6 w-6 text-brand-700" />
          Review questions
        </h1>
        <p className="mt-1 text-sm text-ink-600">
          A random sample of <strong>{APP_CONFIG.title}</strong>, shown with the
          answers, explanations and metadata. Nothing you do here counts as
          practice. Flag a question with the thumbs and it shows up under
          Question feedback in Settings.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-surface p-3 shadow-xs">
        <div
          role="group"
          aria-label="Questions per draw"
          className="inline-flex rounded-xl border border-ink-200 bg-ink-50 p-0.5"
        >
          {REVIEW_BATCH_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              data-testid={`review-size-${n}`}
              aria-pressed={size === n}
              onClick={() => (n === size ? undefined : redraw(n))}
              className={cn(
                'tap-feedback min-h-10 rounded-[10px] px-4 text-sm font-semibold transition',
                size === n
                  ? 'bg-surface text-ink-900 shadow-xs'
                  : 'text-ink-500 hover:text-ink-800',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="secondary"
          data-testid="review-redraw"
          onClick={() => redraw(size)}
        >
          <RefreshCw className="h-4 w-4" />
          Draw again
        </Button>
        <p className="w-full text-xs text-ink-500" data-testid="review-status">
          {!mounted
            ? `${total} questions in this pack.`
            : draw.cycled
              ? `Every one of the ${total} questions has been shown — starting over.`
              : `Showing ${draw.picked.length} of ${total} questions · ${seenCount} seen this visit.`}
        </p>
      </div>

      {!mounted ? (
        <div className="rounded-2xl border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
          Drawing questions…
        </div>
      ) : draw.picked.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
          This pack has no questions yet.
        </div>
      ) : (
        <ol className="flex flex-col gap-6" data-testid="review-list">
          {draw.picked.map((q, i) => (
            <li key={q.id}>
              <ReviewCard question={q} index={i + 1} />
            </li>
          ))}
        </ol>
      )}

      {mounted && draw.picked.length > 0 ? (
        <Button size="lg" block variant="secondary" onClick={() => redraw(size)}>
          <RefreshCw className="h-5 w-5" />
          Draw {size} more
        </Button>
      ) : null}
    </main>
  );
}

/** One question, fully revealed. */
function ReviewCard({ question, index }: { question: PackQuestion; index: number }) {
  const scenario = question.scenarioId
    ? packScenarios.find((s) => s.id === question.scenarioId)
    : undefined;
  const concept = question.conceptId ? PACK_CONCEPT_BY_ID[question.conceptId] : undefined;
  const multi = isMultiAnswer(question);
  const matching = isMatching(question);
  const answer = answerKeysOf(question);
  // Only a URL gets the SourceRef link; show any other ref as text.
  const refIsUrl = /^https?:\/\//.test(question.sourceRef?.trim() ?? '');

  return (
    <article
      data-testid="review-card"
      data-question-id={question.id}
      className="flex flex-col gap-3 rounded-2xl border border-ink-200 bg-surface p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-50">
          {index}
        </span>
        <QuestionMeta question={question} />
        {scenario ? (
          <span className="rounded-full border border-ink-300 bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-700">
            {scenario.title}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
        <span
          data-testid="review-status-chip"
          className={cn('rounded-full border px-2 py-0.5', REVIEW_STATUS_TONE[question.reviewStatus])}
        >
          {question.reviewStatus}
        </span>
        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-ink-600">
          Difficulty {question.difficulty}/5
        </span>
        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-ink-600">{question.source}</span>
        <code className="ml-auto font-mono text-[11px] normal-case tracking-normal text-ink-500">
          {question.id}
        </code>
      </div>

      {scenario?.stem ? (
        <section className="rounded-xl border border-ink-200 bg-ink-50/60 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Scenario
          </div>
          <div className="mt-1 text-[15px] leading-relaxed text-ink-800">
            <McqMarkdown text={scenario.stem} />
          </div>
        </section>
      ) : null}

      <div className="text-[15px] font-medium leading-relaxed text-ink-900">
        <McqMarkdown text={question.prompt} />
      </div>

      {question.image ? (
        <div className="flex justify-center rounded-xl border border-ink-200 bg-surface p-3">
          <PackImage src={question.image} alt="" className="max-h-72 w-auto object-contain" />
        </div>
      ) : null}

      {multi || matching ? (
        <div className="-mb-1 flex items-center gap-1.5 text-xs font-semibold text-brand-700">
          <ListChecks className="h-4 w-4" />
          {matching ? 'One answer per row' : 'Select all that apply'}
        </div>
      ) : null}

      {matching ? (
        <MatchRows question={question} selected={answer} stage="feedback" onSelect={noop} />
      ) : (
        <OptionButtons
          options={question.options ?? []}
          selected={[]}
          stage="feedback"
          correctKeys={correctKeysOf(question)}
          multi={multi}
          onSelect={noop}
        />
      )}

      <div className="flex flex-col gap-2 rounded-xl border border-success-500/30 bg-success-100/50 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-success-700">
          Explanation
        </div>
        <div className="text-[15px] leading-relaxed text-ink-800">
          <McqMarkdown text={question.explanation} />
        </div>
        {concept ? <ConceptCard concept={concept} /> : null}
        {question.sourceRef && !refIsUrl ? (
          <div className="text-xs text-ink-500">
            Source ref: <span className="font-mono">{question.sourceRef}</span>
          </div>
        ) : null}
        <SourceRef sourceRef={question.sourceRef} />
        <NoteOrigin generatedFrom={question.generatedFrom} />
      </div>

      <VoteRow questionId={question.id} />
    </article>
  );
}
