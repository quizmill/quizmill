'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { enabledGames, type GameId } from '@/lib/games/registry';
import { recordEvent } from '@/lib/storage';
import { gamesEnabled, packGames } from '@/pack/data';

// The game components (six games + their logic) are the heavy part of this
// feature. Load them ONLY when a game is actually opened — they're never in
// the games-page chunk, let alone the rest of the app. A pack without games
// never opens one, so it pays only for this small page.
const GameModal = dynamic(
  () => import('@/pack/games/GameModal').then((m) => m.GameModal),
  { ssr: false },
);

/**
 * The games arcade — a small set of break-time games, free to play. A
 * deliberately HIDDEN treat: there's no link from Home; you reach it via
 * the version-pill easter egg in Settings. Gated on the ACTIVE pack's
 * `games` block at render time — the route exists in every build so a
 * pack swapped in at runtime gets its arcade, and a pack without games
 * gets a plain "nothing here" instead of a dead link.
 */
export default function GamesPage() {
  const games = enabledGames(packGames?.include);

  // The open game (null = the grid is showing).
  const [active, setActive] = useState<GameId | null>(null);

  if (!gamesEnabled) {
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
        </header>
        <div
          data-testid="games-none"
          className="rounded-2xl border border-ink-200 bg-surface p-5 text-center shadow-xs"
        >
          <h1 className="text-xl font-bold text-ink-900">No games in this pack</h1>
          <p className="mt-1 text-sm text-ink-500">
            This pack doesn&apos;t include the arcade. Back to practice!
          </p>
        </div>
      </main>
    );
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
          A few quick games to enjoy between rounds of practice.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3" data-testid="games-grid">
        {games.map((g) => (
          <button
            key={g.id}
            type="button"
            data-testid={`game-card-${g.id}`}
            onClick={() => {
              recordEvent('game_open', { game: g.id });
              setActive(g.id);
            }}
            className="tap-feedback group flex flex-col items-center gap-1.5 rounded-2xl border border-ink-200 bg-surface p-4 text-center shadow-xs transition hover:border-brand-500/40 hover:shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="text-4xl leading-none" aria-hidden>
              {g.emoji}
            </span>
            <span className="text-sm font-semibold text-ink-900">{g.name}</span>
            <span className="text-xs leading-tight text-ink-500">{g.blurb}</span>
          </button>
        ))}
      </section>

      {active ? (
        <GameModal game={active} onClose={() => setActive(null)} />
      ) : null}

      <p className="text-center text-xs text-ink-400">
        Games are just for fun — they don&apos;t affect your stats or stickers.
      </p>
    </main>
  );
}
