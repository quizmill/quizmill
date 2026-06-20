'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Gamepad2, Lock } from 'lucide-react';
import { useStorageData } from '@/lib/useStorage';
import { enabledGames, type GameId } from '@/lib/games/registry';
import { packGames, gamesUnlockAfter } from '@/pack/data';
import { GameModal } from '@/pack/games/GameModal';
import { cn } from '@/lib/cn';

/**
 * The games arcade. A reward unlocked once the learner has answered
 * `gamesUnlockAfter` questions: until then the page shows progress toward
 * the unlock; after, a grid of break-time games to dip into. Only mounted
 * for packs that switch games on (the route 404s otherwise).
 */
export default function GamesPage() {
  const { attempts } = useStorageData();
  const games = enabledGames(packGames?.include);

  const answered = attempts.length;
  const unlocked = answered >= gamesUnlockAfter;
  const remaining = Math.max(0, gamesUnlockAfter - answered);
  const pct = Math.min(100, Math.round((answered / gamesUnlockAfter) * 100));

  // The open game (null = the grid / lock screen is showing).
  const [active, setActive] = useState<GameId | null>(null);

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
        {unlocked ? (
          <div className="text-sm font-medium text-ink-500" data-testid="games-count">
            <span className="font-semibold text-ink-900">{games.length}</span>
            <span> {games.length === 1 ? 'game' : 'games'}</span>
          </div>
        ) : null}
      </header>

      <div>
        <h1 className="text-3xl font-bold text-ink-900">Games</h1>
        <p className="mt-1 text-ink-500">
          A few quick games to enjoy between rounds of practice.
        </p>
      </div>

      {unlocked ? (
        <section
          className="grid grid-cols-2 gap-3"
          data-testid="games-grid"
        >
          {games.map((g) => (
            <button
              key={g.id}
              type="button"
              data-testid={`game-card-${g.id}`}
              onClick={() => setActive(g.id)}
              className="tap-feedback group flex flex-col items-center gap-1.5 rounded-2xl border border-ink-200 bg-white p-4 text-center shadow-sm transition hover:border-brand-500/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span className="text-4xl leading-none" aria-hidden>
                {g.emoji}
              </span>
              <span className="text-sm font-semibold text-ink-900">{g.name}</span>
              <span className="text-xs leading-tight text-ink-500">{g.blurb}</span>
            </button>
          ))}
        </section>
      ) : (
        <section
          data-testid="games-locked"
          className="flex flex-col items-center gap-4 rounded-2xl border border-ink-200 bg-white p-6 text-center shadow-sm"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-100 text-ink-400">
            <Lock className="h-7 w-7" />
          </div>
          <div>
            <div className="text-lg font-bold text-ink-900">Games are locked</div>
            <p className="mt-1 text-sm text-ink-600">
              Answer{' '}
              <strong className="text-ink-900">
                {remaining} more {remaining === 1 ? 'question' : 'questions'}
              </strong>{' '}
              to unlock {games.length} {games.length === 1 ? 'game' : 'games'} to
              play.
            </p>
          </div>

          <div className="w-full max-w-xs">
            <div className="flex items-baseline justify-between text-xs text-ink-500">
              <span className="font-medium text-ink-700">
                {Math.min(answered, gamesUnlockAfter)} / {gamesUnlockAfter}
              </span>
              <span>questions answered</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-200">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${pct}%` }}
                data-testid="games-progress-bar"
              />
            </div>
          </div>

          <Link
            href="/"
            className="tap-feedback inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Practise to unlock
            <ArrowRight className="h-4 w-4" />
          </Link>

          {/* A muted preview of what's waiting, so the lock feels like a
              promise rather than a dead end. */}
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            {games.map((g) => (
              <span
                key={g.id}
                title={g.name}
                aria-hidden
                className={cn('text-2xl leading-none grayscale opacity-30')}
              >
                {g.emoji}
              </span>
            ))}
          </div>
        </section>
      )}

      {active ? (
        <GameModal game={active} onClose={() => setActive(null)} />
      ) : null}

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-ink-400">
        <Gamepad2 className="h-3.5 w-3.5" />
        Games are just for fun — they don&apos;t affect your stats or stickers.
      </p>
    </main>
  );
}
