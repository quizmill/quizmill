'use client';

import type { GameId } from '@/lib/games/registry';
import { Dodger } from './Dodger';
import { GameRulesContext } from './GameRules';
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
 */
export function GameModal({ game, onClose, replay = true }: GameModalProps) {
  return (
    <GameRulesContext.Provider value={{ replay }}>
      {pick(game, onClose)}
    </GameRulesContext.Provider>
  );
}
