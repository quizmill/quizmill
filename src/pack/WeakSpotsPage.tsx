'use client';

import Link from 'next/link';
import { ArrowLeft, Crosshair, Play } from 'lucide-react';
import { PackChip } from '@/components/PackChip';
import { Button } from '@/components/ui/Button';
import { useStorageData } from '@/lib/useStorage';
import { useMounted } from '@/lib/useMounted';
import { useDevicePref } from '@/lib/useDevicePref';
import { missedQuestions } from '@/lib/mistakes';
import { weakSpotClearAfterPref } from '@/lib/weakSpotPref';
import {
  packQuestions,
  PACK_CATEGORY_ICON,
  PACK_CATEGORY_LABEL,
  type PackQuestion,
} from '@/pack/data';

/**
 * The weak-spot list: every question the learner has missed and not yet
 * answered right N times in a row (N from Settings), oldest mistake first
 * — the order the review runner deals them. Derived from attempts on
 * every render, so there is nothing to clear by hand: a question leaves
 * by being answered right, and the "cleared" line under the list is that
 * rule made visible. Reads the active pack at render time (questions no
 * longer in it are skipped), like every route.
 */
export default function WeakSpotsPage() {
  const { attempts } = useStorageData();
  const mounted = useMounted();
  const [clearAfter] = useDevicePref(weakSpotClearAfterPref);

  const byId = new Map(packQuestions.map((q) => [q.id, q]));
  const missed = missedQuestions(attempts).flatMap((m) => {
    const question = byId.get(m.id);
    return question ? [{ ...m, question }] : [];
  });
  const listed = missed.filter((m) => m.streak < clearAfter);
  const cleared = missed.length - listed.length;
  const times = clearAfter === 1 ? 'once' : `${clearAfter} times in a row`;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
        {mounted && listed.length > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warn-100/60 px-3 py-1 text-sm font-semibold text-warn-700">
            <Crosshair className="h-4 w-4" />
            {listed.length}
          </span>
        ) : null}
      </header>

      <div>
        <PackChip className="mb-2" />
        <h1 className="text-3xl font-bold text-ink-900">Weak spots</h1>
        <p className="mt-1 text-ink-500">
          Questions you got wrong. Each one stays here until you answer it
          right {times}{' '}
          <Link
            href="/settings/"
            className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
          >
            (change)
          </Link>
          .
        </p>
      </div>

      {!mounted ? null : listed.length === 0 ? (
        <div
          data-testid="weak-spots-empty"
          className="rounded-2xl border border-ink-200 bg-surface p-5 text-sm text-ink-600"
        >
          <p className="font-semibold text-ink-800">No weak spots right now.</p>
          <p className="mt-1.5 leading-relaxed">
            Keep practising — any question you get wrong shows up here so you
            can come back to it.
          </p>
        </div>
      ) : (
        <>
          <Link href="/practice/review/" className="block">
            <Button size="lg" block data-testid="weak-spots-practise">
              <Play className="h-4 w-4" />
              Practise these
            </Button>
          </Link>
          <ul data-testid="weak-spots-list" className="flex flex-col gap-3">
            {listed.map((m) => (
              <WeakSpotRow
                key={m.id}
                question={m.question}
                streak={m.streak}
                clearAfter={clearAfter}
              />
            ))}
          </ul>
        </>
      )}

      {mounted && cleared > 0 ? (
        <p data-testid="weak-spots-cleared" className="text-center text-sm text-ink-500">
          {cleared} {cleared === 1 ? 'question' : 'questions'} cleared — answered
          right {times}.
        </p>
      ) : null}
    </main>
  );
}

function WeakSpotRow({
  question,
  streak,
  clearAfter,
}: {
  question: PackQuestion;
  streak: number;
  clearAfter: number;
}) {
  const categoryLabel = PACK_CATEGORY_LABEL[question.categoryKey] ?? question.categoryKey;
  return (
    <li
      data-testid="weak-spot"
      className="flex flex-col gap-1.5 rounded-2xl border border-ink-200 bg-surface p-4 shadow-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-600">
          <span aria-hidden>{PACK_CATEGORY_ICON[question.categoryKey]}</span>
          {categoryLabel}
        </span>
        {/* With one right answer clearing it, a listed question is always
            at 0 of 1 — no progress worth showing. */}
        {clearAfter > 1 ? (
          <span
            data-testid="weak-spot-streak"
            className="shrink-0 rounded-full bg-warn-100/60 px-2 py-0.5 text-xs font-semibold text-warn-700"
          >
            {streak} of {clearAfter}
          </span>
        ) : null}
      </div>
      <p className="line-clamp-3 text-sm text-ink-700">{question.prompt}</p>
    </li>
  );
}
