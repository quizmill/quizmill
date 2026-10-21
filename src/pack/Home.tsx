'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Car,
  GraduationCap,
  NotebookPen,
  Printer,
  RefreshCw,
  Settings,
  Timer,
  Trophy,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { APP_CONFIG } from '@/config';
import { UnlockedToast } from '@/components/UnlockedToast';
import { PackUpdatedNotice } from '@/components/PackUpdatedNotice';
import { useStorageData } from '@/lib/useStorage';
import { useClientState, useMounted } from '@/lib/useMounted';
import { unresolvedMistakeCount } from '@/lib/mistakes';
import {
  loadLevelFilter,
  saveLevelFilter,
  loadDismissedNudge,
  saveDismissedNudge,
  loadDriveModeEnabled,
} from '@/lib/storage';
import { levelNudge } from '@/lib/stats';
import { loadCoachModeEnabled } from '@/lib/coach';
import { loadPaperModeEnabled } from '@/lib/paper';
import { latestColdLook } from '@/lib/readiness';
import { cn } from '@/lib/cn';
import {
  packQuestions,
  packLevels,
  packLevelKeys,
  packManifest,
  PACK_CATEGORY_TONE,
  PACK_CATEGORY_ICON,
  PACK_LEVEL_LABEL,
  PACK_LEVEL_BY_QUESTION_ID,
} from '@/pack/data';
import { EXAM_SITTING } from '@/pack/exam';
import { formatClock } from '@/lib/examClock';
import { HomeCard, ModeTile } from '@/pack/HomeCard';
import { StreakChip } from '@/pack/StreakChip';
import { UpgradeCard } from '@/pack/UpgradeCard';
import { recordLevelCrossings } from '@/pack/useLevelUp';

/** Runtime-pack mode (quizmill-cloud's served engine): the pack is injected at
 *  boot from the browser, so it differs from the build-time pack baked into the
 *  prerendered HTML. Hold the first paint until mount so the server HTML and the
 *  client's first render agree — no hydration mismatch, no flash of the
 *  build-time pack — then render the injected pack. Off for normal one-pack
 *  deploys, which prerender their own pack exactly as before. (Hydration
 *  itself is guarded for ANY runtime pack by RuntimePackBoundary in the
 *  layout — a library pack made active on /packs included; this skeleton
 *  only exists so a dedicated runtime-pack build never paints the demo
 *  pack first.) */
const RUNTIME_PACK_MODE = process.env.NEXT_PUBLIC_RUNTIME_PACK === '1';

/** The header's round page buttons (desktop; phones use the tab bar). */
const PAGE_LINKS = [
  { href: '/progress', label: 'Progress', icon: BarChart3 },
  { href: '/stickers', label: 'Sticker cabinet', icon: Trophy },
  { href: '/notes', label: 'My notes', icon: NotebookPen },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

function HomeSkeleton() {
  return (
    <main className="flex animate-pulse flex-col gap-6" aria-hidden>
      <div className="h-8 w-2/3 rounded-lg bg-ink-100" />
      <div className="h-10 rounded-full bg-ink-100" />
      <div className="flex flex-col gap-3">
        <div className="h-16 rounded-2xl bg-ink-100" />
        <div className="h-16 rounded-2xl bg-ink-100" />
        <div className="h-16 rounded-2xl bg-ink-100" />
      </div>
    </main>
  );
}

/**
 * Home screen for the generic pack variant: nothing but ways to practise,
 * all driven by the active pack's manifest. Review mistakes, the level
 * filter and the category cards come first; the occasional modes (Drive,
 * Coach, Paper, the timed exam) follow as a rail of tiles. Status (level,
 * streak, answered, readiness) lives on the Progress tab — Home keeps a
 * streak chip in the header — and the app's navigation is the tab bar in
 * the layout, so with every option on the practice loop still fits one
 * phone screen (issue #188).
 */
export default function PackHome() {
  const { attempts } = useStorageData();
  // Active level-band filter (a manifest level key) or null = All. Read
  // from localStorage after mount so SSR/first paint stay stable.
  const [level, setLevelState] = useClientState(loadLevelFilter, null);
  const [dismissedNudge, setDismissedNudge] = useClientState(loadDismissedNudge, null);
  // Drive Mode is opt-in (Settings toggle) — the Home card only shows
  // once it's switched on. Read after mount like the other prefs.
  const [driveMode] = useClientState(loadDriveModeEnabled, false);
  // Coach mode is the same kind of opt-in, for the parent's device.
  const [coachMode] = useClientState(loadCoachModeEnabled, false);
  // Paper practice too — print sheets, mark them back in.
  const [paperMode] = useClientState(loadPaperModeEnabled, false);
  // In runtime-pack mode, hold the first paint until mount (see RUNTIME_PACK_MODE).
  const mounted = useMounted() || !RUNTIME_PACK_MODE;
  useEffect(() => {
    if (RUNTIME_PACK_MODE) document.title = APP_CONFIG.title;
  }, []);
  // Catch-all for history that arrives OUTSIDE a runner (file import,
  // sync merge, another device): whenever Home — the landing route — sees
  // new attempts, any level they earned is persisted, so the high-water
  // record can never lag the ledger for long. No-ops without the pack's
  // opt-in. (ProgressCard runs the same backfill on the Progress tab.)
  useEffect(() => {
    recordLevelCrossings(attempts);
  }, [attempts]);
  const setLevel = (next: string | null) => {
    setLevelState(next);
    saveLevelFilter(next);
  };
  const levelsLabel = packManifest.levelsLabel ?? 'Level';
  // A single level is nothing to filter by: "All" and the level select the
  // same questions, so the row (and the nudge, which needs an adjacent
  // level) only appear from two levels up. The `level` pref and `#level=`
  // hash keep working if set — they just have no UI here (#201).
  const hasLevelAxis = packLevels.length > 1;

  // Adaptive nudge: once the learner is consistently strong (or struggling)
  // at the level they've picked, suggest the adjacent one.
  const nudge = hasLevelAxis
    ? levelNudge(attempts, (id) => PACK_LEVEL_BY_QUESTION_ID[id], packLevelKeys, level)
    : null;
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
  // One row per distinct question (latest cold look), joined back to the
  // question's level so the answered numerator matches the filtered
  // available denominator — and a re-answered question counts once.
  const categoryLooks = latestColdLook(
    attempts,
    (id) => !level || PACK_LEVEL_BY_QUESTION_ID[id] === level,
  );
  for (const a of categoryLooks) {
    const slot = statsByCategory.get(a.subject);
    if (!slot) continue;
    slot.answered++;
    if (a.isCorrect) slot.correct++;
  }

  if (!mounted) return <HomeSkeleton />;

  return (
    <main className="flex flex-col gap-6">
      {/* Compact header: the title, a subtitle clamped to two lines, the
          streak chip, and — from sm: up — the four round page buttons the
          header always had. On phones those are the layout's tab bar. */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">
            {APP_CONFIG.title}
          </h1>
          <p className="mt-1 line-clamp-2 text-sm text-ink-500 sm:text-base">
            {APP_CONFIG.homeSubtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          <StreakChip attempts={attempts} />
          <nav aria-label="Pages" className="hidden items-center gap-2 sm:flex">
            {PAGE_LINKS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-label={label}
                className="tap-feedback inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-surface text-ink-700 shadow-xs"
              >
                <Icon className="h-4 w-4" />
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* One-time "Unlocked: N questions" after a licence-key unlock landed
          here (sessionStorage; see UnlockedToast). */}
      <UnlockedToast />
      {/* One-time "Updated: now N questions" after an unlocked pack's daily
          check fetched a newer bundle (sessionStorage; see PackUpdatedNotice). */}
      <PackUpdatedNotice />

      {mistakeCount > 0 ? (
        <HomeCard
          href="/practice/review/"
          tone="warn"
          icon={RefreshCw}
          title={
            <>
              Review {mistakeCount} {mistakeCount === 1 ? 'mistake' : 'mistakes'}
            </>
          }
          blurb="Retry the questions you got wrong."
        />
      ) : null}

      {hasLevelAxis ? (
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
                      ? 'bg-surface text-ink-900 shadow-xs'
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
                'flex items-center justify-between gap-3 rounded-2xl border p-3 shadow-xs',
                nudge.direction === 'up'
                  ? 'border-brand-500/30 bg-brand-50'
                  : 'border-warn-500/30 bg-warn-50',
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {nudge.direction === 'up' ? (
                  <TrendingUp className="h-5 w-5 shrink-0 text-brand-600" />
                ) : (
                  <TrendingDown className="h-5 w-5 shrink-0 text-warn-600" />
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
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={acceptNudge}
                  className="tap-feedback whitespace-nowrap rounded-full bg-night-900 px-3 py-1.5 text-xs font-semibold text-white"
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
            const s = statsByCategory.get(cat.key);
            if (!s) return null;
            const pct =
              s.answered === 0 ? 0 : Math.round((s.correct / s.answered) * 100);
            const weight = cat.weight ? `${Math.round(cat.weight * 100)}%` : null;
            const tone = PACK_CATEGORY_TONE[cat.key];
            const icon = PACK_CATEGORY_ICON[cat.key];
            return (
              <Link
                key={cat.key}
                href={`/practice/?subject=${cat.key}`}
                className={cn(
                  'tap-feedback group flex items-center justify-between gap-3 rounded-2xl border p-4 shadow-xs transition hover:shadow-md',
                  tone.card,
                )}
              >
                <span
                  className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl leading-none',
                    tone.badge,
                  )}
                  aria-hidden
                >
                  {icon}
                </span>
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
                  className={cn('h-5 w-5 shrink-0 transition', tone.arrow)}
                />
              </Link>
            );
          })}
        </div>
      </section>

      {/* The occasional modes as a rail of tiles — one row however many are
          on. Drive, Coach and Paper are device opt-ins (Settings); the
          timed sitting shows for packs that declare an exam length. */}
      {driveMode || coachMode || paperMode || EXAM_SITTING ? (
        <section className="flex flex-col gap-3" data-testid="mode-rail">
          <h2 className="text-lg font-semibold text-ink-700">More ways to practise</h2>
          <div className="flex gap-2">
            {driveMode ? (
              <ModeTile
                href="/drive/"
                testid="drive-card"
                tone="night"
                icon={Car}
                label="Drive"
                caption="By voice"
              />
            ) : null}
            {coachMode ? (
              <ModeTile
                href="/coach/"
                testid="coach-card"
                tone="brand"
                icon={GraduationCap}
                label="Coach"
                caption="Replay"
              />
            ) : null}
            {paperMode ? (
              <ModeTile
                href="/paper/"
                testid="paper-card"
                tone="ink"
                icon={Printer}
                label="Paper"
                caption="Print & mark"
              />
            ) : null}
            {EXAM_SITTING ? (
              <ModeTile
                href="/practice/exam/"
                testid="exam-card"
                tone="ink"
                icon={Timer}
                label={APP_CONFIG.exam?.label ?? 'Timed exam'}
                caption={`${EXAM_SITTING.count} Qs · ${formatClock(EXAM_SITTING.durationSeconds)}`}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* The pack's upgrade pitch, if it has one — last, below the practice
          loop: a sampler sells itself by being practised, not by a banner. */}
      <UpgradeCard placement="home" />
    </main>
  );
}
