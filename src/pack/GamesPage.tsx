'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Gamepad2 } from 'lucide-react';
import { enabledGames, type GameId } from '@/lib/games/registry';
import { packGames, gamesDailyLimit } from '@/pack/data';
import { GameModal } from '@/pack/games/GameModal';
import { loadGamePlaysToday, recordGamePlay } from '@/lib/storage';

/**
 * The games arcade — a small set of break-time games. Reached via the
 * hidden version-pill easter egg in Settings. A daily play cap keeps it a
 * treat: by default one game a day (per-pack `games.dailyLimit`; 0 =
 * unlimited), resetting at local midnight. Only mounted for packs that
 * switch games on (the route 404s otherwise).
 */
export default function GamesPage() {
  const games = enabledGames(packGames?.include);

  // The open game (null = the grid / capped screen is showing).
  const [active, setActive] = useState<GameId | null>(null);
  // null until read on the client — avoids a grid→capped flash on first paint.
  const [playsToday, setPlaysToday] = useState<number | null>(null);
  useEffect(() => setPlaysToday(loadGamePlaysToday()), []);

  const capped =
    gamesDailyLimit > 0 && playsToday !== null && playsToday >= gamesDailyLimit;

  function play(id: GameId) {
    setPlaysToday(recordGamePlay());
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
        <div className="text-sm font-medium text-ink-500" data-testid="games-count">
          <span className="font-semibold text-ink-900">{games.length}</span>
          <span> {games.length === 1 ? 'game' : 'games'}</span>
        </div>
      </header>

      <div>
        <h1 className="text-3xl font-bold text-ink-900">Games</h1>
        <p className="mt-1 text-ink-500">
          {gamesDailyLimit === 1
            ? 'One quick game to enjoy between rounds of practice.'
            : 'A few quick games to enjoy between rounds of practice.'}
        </p>
      </div>

      {playsToday === null ? null : capped ? (
        <section
          data-testid="games-capped"
          className="flex flex-col items-center gap-4 rounded-2xl border border-ink-200 bg-white p-6 text-center shadow-sm"
        >
          <div className="text-5xl leading-none" aria-hidden>
            🎉
          </div>
          <div>
            <div className="text-lg font-bold text-ink-900">
              That&apos;s your game for today!
            </div>
            <p className="mt-1 text-sm text-ink-600">
              {gamesDailyLimit === 1
                ? 'One a day keeps it a treat — come back tomorrow to play again.'
                : `You've played your ${gamesDailyLimit} games for today — come back tomorrow.`}
            </p>
          </div>
          <Link
            href="/"
            className="tap-feedback inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Back to practice
            <ArrowRight className="h-4 w-4" />
          </Link>
          {/* A muted line-up of what's waiting tomorrow. */}
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
      ) : (
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
