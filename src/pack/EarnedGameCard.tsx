'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { enabledGames, type GameId } from '@/lib/games/registry';
import { earnsGame } from '@/lib/games/reward';
import { useSuspended } from '@/pack/games/useSuspended';
import { recordEvent } from '@/lib/storage';
import { gamesShownPref } from '@/lib/gamesPref';
import { useDevicePref } from '@/lib/useDevicePref';
import { gamesEnabled, packGames } from '@/pack/data';

// The games themselves are the heavy part — fetched only when one is
// actually opened, never in the practice runner's chunk.
const GameModal = dynamic(
  () => import('@/pack/games/GameModal').then((m) => m.GameModal),
  { ssr: false },
);

interface EarnedGameCardProps {
  correct: number;
  total: number;
}

type Phase = 'ready' | 'playing' | 'played';

/**
 * The reward on the practice results screen: a good round (half or more
 * right — `earnsGame`) earns ONE game, picked from the pack's arcade and
 * played right here until game over. No "Play again" (the modal runs
 * under `replay: false`), nothing stored: leave the screen and the offer
 * is gone, finish another round and a fresh one appears. Renders nothing
 * for a pack without a `games` block, a device that hid the games
 * (Settings → Games) or a round below the bar.
 */
export function EarnedGameCard({ correct, total }: EarnedGameCardProps) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [game, setGame] = useState<GameId | null>(null);
  const [gamesShown] = useDevicePref(gamesShownPref);

  if (!gamesEnabled || !gamesShown || !earnsGame(correct, total)) return null;
  const games = enabledGames(packGames?.include);
  if (games.length === 0) return null;

  if (phase === 'played') {
    return (
      <div
        data-testid="earned-game-played"
        className="rounded-xl border border-ink-200 bg-ink-50/60 p-3 text-sm text-ink-600"
      >
        🎮 Game played — finish another round to earn the next.
      </div>
    );
  }

  return (
    <div
      data-testid="earned-game"
      className="rounded-xl border border-brand-500/30 bg-brand-50 p-3 text-left"
    >
      <div className="text-base font-bold text-ink-900">🎮 You earned a game!</div>
      <p className="mt-0.5 text-sm text-ink-600">
        Pick one — it&apos;s yours until game over.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {games.map((g) => (
          <button
            key={g.id}
            type="button"
            data-testid={`earned-game-${g.id}`}
            // One pick per offer: once a game is open (or its chunk is
            // still loading) the others can't swap in behind the modal.
            disabled={phase !== 'ready'}
            onClick={() => {
              if (phase !== 'ready') return;
              recordEvent('game_open', { game: g.id, via: 'earned' });
              setGame(g.id);
              setPhase('playing');
            }}
            className="tap-feedback flex flex-col items-center gap-1 rounded-xl border border-ink-200 bg-surface px-2 py-2.5 text-center shadow-xs transition hover:border-brand-500/40 disabled:opacity-50 disabled:hover:border-ink-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="text-2xl leading-none" aria-hidden>
              {g.emoji}
            </span>
            <span className="text-xs font-semibold text-ink-900">{g.name}</span>
            <ContinueTag id={g.id} />
          </button>
        ))}
      </div>

      {phase === 'playing' && game ? (
        <GameModal
          game={game}
          replay={false}
          onClose={() => {
            setGame(null);
            setPhase('played');
          }}
        />
      ) : null}
    </div>
  );
}

/** "Continue" under a game left paused by an earlier session. */
function ContinueTag({ id }: { id: GameId }) {
  if (!useSuspended(id)) return null;
  return (
    <span
      data-testid={`earned-resume-${id}`}
      className="text-[10px] font-semibold uppercase tracking-wide text-brand-700"
    >
      Continue
    </span>
  );
}
