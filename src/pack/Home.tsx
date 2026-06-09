'use client';

import Link from 'next/link';
import { ArrowRight, RefreshCw, Settings } from 'lucide-react';
import { APP_CONFIG } from '@/config';
import { StatTile } from '@/components/StatTile';
import { useStorageData } from '@/lib/useStorage';
import { unresolvedMistakeCount } from '@/lib/mistakes';
import { packQuestions } from '@/pack/data';

/** Home screen for the generic pack variant — category cards + stats,
 *  all driven by the active pack's manifest. Mirrors the CCA home
 *  minus the CCA-specific bits (achievements, blueprint-weight title). */
export default function PackHome() {
  const { attempts } = useStorageData();
  const totalAnswered = attempts.length;
  const totalCorrect = attempts.filter((a) => a.isCorrect).length;
  const overallAccuracy =
    totalAnswered === 0 ? 0 : Math.round((totalCorrect / totalAnswered) * 100);
  const mistakeCount = unresolvedMistakeCount(attempts);

  const statsByCategory = new Map<
    string,
    { available: number; answered: number; correct: number }
  >();
  for (const cat of APP_CONFIG.categories) {
    statsByCategory.set(cat.key, { available: 0, answered: 0, correct: 0 });
  }
  for (const q of packQuestions) {
    const slot = statsByCategory.get(q.categoryKey);
    if (slot) slot.available++;
  }
  for (const a of attempts) {
    const slot = statsByCategory.get(a.subject);
    if (!slot) continue;
    slot.answered++;
    if (a.isCorrect) slot.correct++;
  }

  return (
    <main className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-bold text-ink-900">{APP_CONFIG.title}</h1>
          <p className="mt-1 text-ink-500">{APP_CONFIG.homeSubtitle}</p>
        </div>
        <Link
          href="/settings"
          aria-label="Settings"
          className="tap-feedback inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-700 shadow-sm"
        >
          <Settings className="h-4 w-4" />
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <StatTile
          label="Answered"
          value={totalAnswered}
          hint={
            totalAnswered === 0
              ? `0 of ${packQuestions.length} available`
              : `of ${packQuestions.length} available`
          }
        />
        <StatTile
          label="Accuracy"
          value={`${overallAccuracy}%`}
          hint={
            totalAnswered === 0
              ? 'no data yet'
              : `${totalCorrect}/${totalAnswered} correct`
          }
        />
      </section>

      {mistakeCount > 0 ? (
        <Link
          href="/practice/review/"
          className="tap-feedback flex items-center justify-between gap-3 rounded-2xl border border-warn-500/40 bg-warn-100/60 p-4 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-warn-500/20 text-warn-700">
              <RefreshCw className="h-5 w-5" />
            </div>
            <div>
              <div className="text-base font-semibold text-ink-900">
                Review {mistakeCount}{' '}
                {mistakeCount === 1 ? 'mistake' : 'mistakes'}
              </div>
              <div className="text-sm text-ink-600">
                Retry the questions you got wrong.
              </div>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 flex-shrink-0 text-ink-500" />
        </Link>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink-700">Pick a category</h2>
        </div>
        <div className="flex flex-col gap-2.5">
          {APP_CONFIG.categories.map((cat) => {
            const s = statsByCategory.get(cat.key)!;
            const pct =
              s.answered === 0 ? 0 : Math.round((s.correct / s.answered) * 100);
            const weight = cat.weight ? `${Math.round(cat.weight * 100)}%` : null;
            return (
              <Link
                key={cat.key}
                href={`/practice/${cat.key}/`}
                className="tap-feedback group flex items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow-md"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-ink-900">
                      {cat.label}
                    </span>
                    {weight ? (
                      <span
                        title="Share of practice sessions this category targets"
                        className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700"
                      >
                        {weight}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-ink-500">
                    {s.answered === 0
                      ? `${s.available} questions available`
                      : `${s.answered}/${s.available} answered · ${pct}% accuracy`}
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 flex-shrink-0 text-ink-400 transition group-hover:text-brand-600" />
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
