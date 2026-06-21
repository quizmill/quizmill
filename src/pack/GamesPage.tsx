'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useStorageData } from '@/lib/useStorage';
import { enabledGames, type GameId } from '@/lib/games/registry';
import { packGames, gamesEarnEvery } from '@/pack/data';
import { loadGamesPlayed, recordGamePlay } from '@/lib/storage';

// The game components (six games + their logic) are the heavy part of this
// feature. Load them ONLY when a game is actually opened — they're never in
// the games-page chunk, let alone the rest of the app. Packs without games
// never reach this route at all (it 404s), so they pay nothing.
const GameModal = dynamic(
  () => import('@/pack/games/GameModal').then((m) => m.GameModal),
  { ssr: false },
);

/**
 * The games arcade. Games are EARNED by practising — one play per
 * `gamesEarnEvery` correct answers (default 10; 0 = always free) — and
 * spent when you play. Reached via the hidden version-pill easter egg in
 * Settings; only mounted for packs that switch games on (route 404s
 * otherwise).
 */
export default function GamesPage() {
  const { attempts } = useStorageData();
  const games = enabledGames(packGames?.include);

  const correct = attempts.filter((a) => a.isCorrect).length;
  const free = gamesEarnEvery <= 0;
  const earned = free ? Infinity : Math.floor(correct / gamesEarnEvery);

  // Cumulative plays spent — read on the client (null until then, so the
  // earn/grid states don't flash before we know the real balance).
  const [spent, setSpent] = useState<number | null>(null);
  useEffect(() => setSpent(loadGamesPlayed()), []);

  const available = spent === null ? null : Math.max(0, earned - spent);
  const canPlay = available === null ? null : available > 0;

  // Progress toward the next earned play.
  const toward = free ? 0 : correct % gamesEarnEvery;
  const needed = free ? 0 : gamesEarnEvery - toward;
  const pct = free ? 100 : Math.round((toward / gamesEarnEvery) * 100);

  const [active, setActive] = useState<GameId | null>(null);
  function play(id: GameId) {
    setSpent(recordGamePlay());
    setActive(id);
  }

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
        {available !== null && Number.isFinite(available) && available > 0 ? (
          <div
            className="rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-700"
            data-testid="games-available"
          >
            {available} {available === 1 ? 'play' : 'plays'} ready
          </div>
        ) : null}
      </header>

      <div>
        <h1 className="text-3xl font-bold text-ink-900">Games</h1>
        <p className="mt-1 text-ink-500">
          {free
            ? 'A few quick games to enjoy between rounds of practice.'
            : `Earn a game every ${gamesEarnEvery} correct answers, then play.`}
        </p>
      </div>

      {available === null ? null : canPlay ? (
        <section className="grid grid-cols-2 gap-3" data-testid="games-grid">
          {games.map((g) => (
            <button
              key={g.id}
              type="button"
              data-testid={`game-card-${g.id}`}
              onClick={() => play(g.id)}
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
          data-testid="games-earn"
          className="flex flex-col items-center gap-4 rounded-2xl border border-ink-200 bg-white p-6 text-center shadow-sm"
        >
          <div className="text-5xl leading-none" aria-hidden>
            🎯
          </div>
          <div>
            <div className="text-lg font-bold text-ink-900">Earn your next game</div>
            <p className="mt-1 text-sm text-ink-600">
              Get{' '}
              <strong className="text-ink-900">
                {needed} more correct {needed === 1 ? 'answer' : 'answers'}
              </strong>{' '}
              to earn a game to play.
            </p>
          </div>

          <div className="w-full max-w-xs">
            <div className="flex items-baseline justify-between text-xs text-ink-500">
              <span className="font-medium text-ink-700">
                {toward} / {gamesEarnEvery}
              </span>
              <span>toward your next game</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-200">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${pct}%` }}
                data-testid="games-earn-bar"
              />
            </div>
          </div>

          <Link
            href="/"
            className="tap-feedback inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Practise to earn one
            <ArrowRight className="h-4 w-4" />
          </Link>

          {/* A muted line-up of what's waiting. */}
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            {games.map((g) => (
              <span
                key={g.id}
                title={g.name}
                aria-hidden
                className="text-2xl leading-none grayscale opacity-30"
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

      <p className="text-center text-xs text-ink-400">
        Games are just for fun — they don&apos;t affect your stats or stickers.
      </p>
    </main>
  );
}
