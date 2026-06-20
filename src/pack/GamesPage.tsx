'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Gamepad2 } from 'lucide-react';
import { enabledGames, type GameId } from '@/lib/games/registry';
import { packGames } from '@/pack/data';
import { GameModal } from '@/pack/games/GameModal';

/**
 * The games arcade — a small set of break-time games to dip into. Reached
 * via the hidden version-pill easter egg in Settings; playable straight
 * away (no gate). Only mounted for packs that switch games on (the route
 * 404s otherwise).
 */
export default function GamesPage() {
  const games = enabledGames(packGames?.include);

  // The open game (null = the grid is showing).
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
