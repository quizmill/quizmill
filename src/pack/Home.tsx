'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Gamepad2,
  RefreshCw,
  Settings,
  TrendingDown,
  TrendingUp,
  Trophy,
  X,
} from 'lucide-react';
import { APP_CONFIG } from '@/config';
import { StatTile } from '@/components/StatTile';
import { InstallBanner } from '@/components/InstallPrompt';
import { useStorageData } from '@/lib/useStorage';
import { unresolvedMistakeCount } from '@/lib/mistakes';
import {
  loadLevelFilter,
  saveLevelFilter,
  loadDismissedNudge,
  saveDismissedNudge,
  loadGamesUnlockSeen,
  saveGamesUnlockSeen,
} from '@/lib/storage';
import { levelNudge } from '@/lib/stats';
import { cn } from '@/lib/cn';
import {
  packQuestions,
  packLevels,
  packLevelKeys,
  packManifest,
  PACK_CATEGORY_TONE,
  PACK_LEVEL_LABEL,
  PACK_LEVEL_BY_QUESTION_ID,
  gamesEnabled,
  gamesUnlockAfter,
} from '@/pack/data';
import { ExamReadinessTile } from '@/pack/ExamReadiness';

/** Home screen for the generic pack variant — category cards + stats,
 *  all driven by the active pack's manifest. */
export default function PackHome() {
  const { attempts } = useStorageData();
  // Active level-band filter (a manifest level key) or null = All. Read
  // from localStorage after mount so SSR/first paint stay stable.
  const [level, setLevelState] = useState<string | null>(null);
  const [dismissedNudge, setDismissedNudge] = useState<string | null>(null);
  // Default true so the unlock banner never flashes before we've read the
  // pref on the client (SSR/first paint render it hidden).
  const [gamesUnlockSeen, setGamesUnlockSeen] = useState(true);
  useEffect(() => {
    setLevelState(loadLevelFilter());
    setDismissedNudge(loadDismissedNudge());
    setGamesUnlockSeen(loadGamesUnlockSeen());
  }, []);
  const dismissGamesUnlock = () => {
    setGamesUnlockSeen(true);
    saveGamesUnlockSeen(true);
  };
  const setLevel = (next: string | null) => {
    setLevelState(next);
    saveLevelFilter(next);
  };
  const levelsLabel = packManifest.levelsLabel ?? 'Level';

  // Adaptive nudge: once the learner is consistently strong (or struggling)
  // at the level they've picked, suggest the adjacent one.
  const nudge = levelNudge(
    attempts,
    (id) => PACK_LEVEL_BY_QUESTION_ID[id],
    packLevelKeys,
    level,
  );
  const nudgeKey = nudge ? `${nudge.from}>${nudge.to}` : null;
  const showNudge = nudge !== null && nudgeKey !== dismissedNudge;
  const dismissNudge = () => {
    if (!nudgeKey) return;
    setDismissedNudge(nudgeKey);
    saveDismissedNudge(nudgeKey);
  };
  const acceptNudge = () => {
    if (!nudge) return;
    setLevel(nudge.to);
  };

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
    if (level && q.level !== level) continue;
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
        <nav className="flex items-center gap-2">
          {gamesEnabled ? (
            <Link
              href="/games"
              aria-label="Games"
              className="tap-feedback inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-700 shadow-sm"
            >
              <Gamepad2 className="h-4 w-4" />
            </Link>
          ) : null}
          <Link
            href="/progress"
            aria-label="Progress"
            className="tap-feedback inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-700 shadow-sm"
          >
            <BarChart3 className="h-4 w-4" />
          </Link>
          <Link
            href="/stickers"
            aria-label="Sticker cabinet"
            className="tap-feedback inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-700 shadow-sm"
          >
            <Trophy className="h-4 w-4" />
          </Link>
          <Link
            href="/settings"
            aria-label="Settings"
            className="tap-feedback inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-700 shadow-sm"
          >
            <Settings className="h-4 w-4" />
          </Link>
        </nav>
      </header>

      <InstallBanner />

      {gamesEnabled && totalAnswered >= gamesUnlockAfter && !gamesUnlockSeen ? (
        <div
          data-testid="games-unlocked-banner"
          className="flex items-center justify-between gap-3 rounded-2xl border border-brand-500/40 bg-brand-50 p-4 shadow-sm"
        >
          <Link
            href="/games/"
            onClick={dismissGamesUnlock}
            className="tap-feedback flex min-w-0 items-center gap-3"
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-brand-700">
              <Gamepad2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold text-ink-900">
                🎮 Games unlocked!
              </div>
              <div className="text-sm text-ink-600">
                You&apos;ve earned a break — tap to play.
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={dismissGamesUnlock}
            aria-label="Dismiss"
            className="tap-feedback inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-ink-400 hover:text-ink-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <section
        className={cn('grid gap-3', APP_CONFIG.exam ? 'grid-cols-3' : 'grid-cols-2')}
      >
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
        <ExamReadinessTile attempts={attempts} />
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

      {packLevels.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-700">{levelsLabel}</h2>
          <div
            className="flex gap-1 rounded-full bg-ink-100 p-1"
            role="radiogroup"
            aria-label={`Filter by ${levelsLabel}`}
          >
            {[{ key: null as string | null, label: 'All' }, ...packLevels].map((lv) => {
              const active = level === lv.key;
              return (
                <button
                  key={lv.key ?? '__all'}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setLevel(lv.key)}
                  className={cn(
                    'tap-feedback flex-1 rounded-full px-2.5 py-1.5 text-sm font-semibold transition-colors',
                    active
                      ? 'bg-white text-ink-900 shadow-sm'
                      : 'text-ink-600 hover:text-ink-900',
                  )}
                >
                  {lv.label}
                </button>
              );
            })}
          </div>

          {showNudge && nudge ? (
            <div
              className={cn(
                'flex items-center justify-between gap-3 rounded-2xl border p-3 shadow-sm',
                nudge.direction === 'up'
                  ? 'border-brand-500/30 bg-brand-50'
                  : 'border-warn-500/30 bg-warn-50',
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {nudge.direction === 'up' ? (
                  <TrendingUp className="h-5 w-5 flex-shrink-0 text-brand-600" />
                ) : (
                  <TrendingDown className="h-5 w-5 flex-shrink-0 text-warn-600" />
                )}
                <p className="text-sm text-ink-700">
                  {nudge.direction === 'up' ? (
                    <>
                      You&apos;re flying through{' '}
                      <strong>{PACK_LEVEL_LABEL[nudge.from]}</strong> (
                      {nudge.accuracyPct}% lately). Ready for{' '}
                      <strong>{PACK_LEVEL_LABEL[nudge.to]}</strong>?
                    </>
                  ) : (
                    <>
                      <strong>{PACK_LEVEL_LABEL[nudge.from]}</strong> is a stretch
                      right now ({nudge.accuracyPct}%).{' '}
                      <strong>{PACK_LEVEL_LABEL[nudge.to]}</strong> might suit
                      better.
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={acceptNudge}
                  className="tap-feedback whitespace-nowrap rounded-full bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Try {PACK_LEVEL_LABEL[nudge.to]}
                </button>
                <button
                  type="button"
                  onClick={dismissNudge}
                  aria-label="Dismiss suggestion"
                  className="tap-feedback inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-400 hover:text-ink-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </section>
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
            const tone = PACK_CATEGORY_TONE[cat.key];
            return (
              <Link
                key={cat.key}
                href={`/practice/${cat.key}/`}
                className={cn(
                  'tap-feedback group flex items-center justify-between gap-3 rounded-2xl border p-4 shadow-sm transition hover:shadow-md',
                  tone.card,
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-ink-900">
                      {cat.label}
                    </span>
                    {weight ? (
                      <span
                        title="Share of practice sessions this category targets"
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                          tone.badge,
                        )}
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
                <ArrowRight
                  className={cn('h-5 w-5 flex-shrink-0 transition', tone.arrow)}
                />
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
