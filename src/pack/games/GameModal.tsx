'use client';

import { useEffect, useState } from 'react';
import { GAMES, GAME_SESSION_MS, type GameId } from '@/lib/games/registry';
import { Dodger } from './Dodger';
import { GameOver } from './GameOver';
import { GameRulesContext } from './GameRules';
import { GameShell } from './GameShell';
import { useSuspended } from './useSuspended';
import { Memory } from './Memory';
import { Pong } from './Pong';
import { Snake } from './Snake';
import { Tetris } from './Tetris';
import { TilePuzzle } from './TilePuzzle';
import { Whack } from './Whack';

interface GameModalProps {
  game: GameId;
  onClose: () => void;
  /**
   * Whether the game may be started over once it ends. The arcade's free
   * play (default) says yes; a game earned by a practice round is one
   * game until game over, so the results screen passes false.
   */
  replay?: boolean;
}

function pick(game: GameId, onClose: () => void) {
  switch (game) {
    case 'snake':
      return <Snake onClose={onClose} />;
    case 'tile-puzzle':
      return <TilePuzzle onClose={onClose} />;
    case 'memory':
      return <Memory onClose={onClose} />;
    case 'whack':
      return <Whack onClose={onClose} />;
    case 'pong':
      return <Pong onClose={onClose} />;
    case 'dodger':
      return <Dodger onClose={onClose} />;
    case 'tetris':
      return <Tetris onClose={onClose} />;
    default:
      return null;
  }
}

/**
 * Picks the right game component for `game` and renders it under the
 * rules it is played by. The actual modal chrome (backdrop, header,
 * close) lives inside each game's `<GameShell>` wrapper.
 *
 * Every session is capped at `GAME_SESSION_MS` (10 minutes), whichever
 * way it was opened and however often it was restarted: when the time is
 * up the game is unmounted — its loops stop with it — and a "Time's up"
 * panel offers Done only. A resumable game (Tetris, Snake) puts itself
 * aside as it unmounts, so the next session carries on where this one
 * stopped; the panel says so.
 */
export function GameModal({ game, onClose, replay = true }: GameModalProps) {
  const [timeUp, setTimeUp] = useState(false);
  // Whether the game was put aside — true only once it has unmounted, so
  // live: the "Time's up" panel re-renders when the game saves itself.
  const paused = useSuspended(game);
  useEffect(() => {
    const id = setTimeout(() => setTimeUp(true), GAME_SESSION_MS);
    return () => clearTimeout(id);
  }, []);

  if (timeUp) {
    const def = GAMES.find((g) => g.id === game);
    return (
      <GameRulesContext.Provider value={{ replay: false }}>
        <GameShell title={def?.name ?? 'Game'} emoji={def?.emoji ?? '🎮'} onClose={onClose}>
          <GameOver
            tone="win"
            title="Time's up! ⏰"
            detail={
              paused
                ? 'Your game is paused — earn another to carry on where you left off.'
                : `Games stop after ${GAME_SESSION_MS / 60_000} minutes — back to practice.`
            }
            testId="game-time-up"
            onRestart={() => {}}
            onClose={onClose}
          />
        </GameShell>
      </GameRulesContext.Provider>
    );
  }

  return (
    <GameRulesContext.Provider value={{ replay }}>
      {pick(game, onClose)}
    </GameRulesContext.Provider>
  );
}
