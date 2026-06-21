'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Sparkles, Star } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { McqMarkdown } from '@/components/McqMarkdown';
import { SourceRef } from '@/components/SourceRef';
import { StarButton } from '@/components/StarButton';
import { ConceptCard } from '@/pack/ConceptCard';
import { useStarredQuestions, useStorageData } from '@/lib/useStorage';
import {
  packQuestions,
  PACK_CATEGORY_LABEL,
  PACK_CONCEPT_BY_ID,
  type PackQuestion,
} from '@/pack/data';
import { pickSessionFromBank, relatedTopicBank } from '@/pack/runner';
import { StarredRunner } from '@/pack/StarredRunner';

/**
 * The "starred questions" hub. Two things the learner can do with the
 * questions they flagged:
 *   1. Study the material around them — each card shows the answer,
 *      explanation, and the linked teaching concept, in one place.
 *   2. Practise follow-up questions on the same topics — a fresh round
 *      picked from every question that shares a concept / category / tag
 *      with something starred (see runner.relatedTopicBank).
 */
export function StarredPage() {
  const { attempts } = useStorageData();
  const { stars, starsList } = useStarredQuestions();

  // Build a picked follow-up round on demand; `null` = not practising.
  const [round, setRound] = useState<PackQuestion[] | null>(null);

  const byId = useMemo(
    () => new Map(packQuestions.map((q) => [q.id, q])),
    [],
  );

  // Starred questions that still exist in the active pack, newest first.
  const starred = useMemo(
    () =>
      [...starsList]
        .sort((a, b) => b.starredAt - a.starredAt)
        .map((s) => byId.get(s.questionId))
        .filter((q): q is PackQuestion => q !== undefined),
    [starsList, byId],
  );

  const followUpBank = useMemo(
    () => relatedTopicBank(packQuestions, stars),
    [stars],
  );

  function startPractice() {
    const historical = new Set(attempts.map((a) => a.questionId));
    const picked = pickSessionFromBank(followUpBank, historical);
    if (picked && picked.length > 0) setRound(picked);
  }

  if (round) {
    return (
      <StarredRunner
        questions={round}
        onRestart={() => {
          setRound(null);
          // Re-pick on the next tick so a fresh session id / question
          // selection is used for the new round.
          setTimeout(startPractice, 0);
        }}
        onExit={() => setRound(null)}
      />
    );
  }

  return (
    <main className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <BackLink />
      </header>

      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold text-ink-900">
          <Star className="h-7 w-7 text-brand-500" />
          Starred
        </h1>
        <p className="mt-1 text-ink-500">
          Questions you saved to review and refine. Study the material
          around them, then practise follow-up questions on the same topics.
        </p>
      </div>

      {starred.length === 0 ? (
        <div className="rounded-2xl border border-ink-200 bg-white p-6 text-center shadow-sm">
          <h2 className="text-xl font-bold text-ink-900">No starred questions yet</h2>
          <p className="mt-2 text-ink-600">
            Tap the star in the answer-feedback panel during practice to save
            a question here for later review.
          </p>
          <Link href="/" className="mt-4 inline-block">
            <Button size="lg">Back to home</Button>
          </Link>
        </div>
      ) : (
        <>
          <Button size="lg" block onClick={startPractice} disabled={followUpBank.length === 0}>
            <Sparkles className="h-4 w-4" />
            Practise follow-up questions
          </Button>
          <p className="-mt-2 text-center text-xs text-ink-500">
            {followUpBank.length} question{followUpBank.length === 1 ? '' : 's'} on
            your starred topics
          </p>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-ink-700">
              Review material ({starred.length})
            </h2>
            {starred.map((q) => (
              <StarredCard key={q.id} question={q} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function StarredCard({ question }: { question: PackQuestion }) {
  const concept = question.conceptId
    ? PACK_CONCEPT_BY_ID[question.conceptId]
    : undefined;
  const correct = question.options.find((o) => o.key === question.correctKey);

  return (
    <details className="rounded-2xl border border-ink-200 bg-white p-4 shadow-sm">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            {PACK_CATEGORY_LABEL[question.categoryKey] ?? question.categoryKey}
          </div>
          <div className="mt-1 line-clamp-2 text-[15px] font-medium text-ink-900">
            <McqMarkdown text={question.prompt} />
          </div>
        </div>
        <StarButton questionId={question.id} variant="icon" />
      </summary>

      <div className="mt-3 flex flex-col gap-3 border-t border-ink-100 pt-3">
        <div className="text-[15px] text-ink-700">
          Answer:{' '}
          <span className="font-semibold text-ink-900">
            {question.correctKey}
            {correct ? <> — {correct.text}</> : null}
          </span>
        </div>
        <div className="text-[15px] leading-relaxed text-ink-800">
          <McqMarkdown text={question.explanation} />
        </div>
        {concept ? <ConceptCard concept={concept} defaultOpen /> : null}
        <SourceRef sourceRef={question.sourceRef} />
      </div>
    </details>
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
