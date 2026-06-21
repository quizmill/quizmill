'use client';

import type { GameId } from '@/lib/games/registry';
import { Dodger } from './Dodger';
import { Memory } from './Memory';
import { Pong } from './Pong';
import { Snake } from './Snake';
import { TilePuzzle } from './TilePuzzle';
import { Whack } from './Whack';

interface GameModalProps {
  game: GameId;
  onClose: () => void;
}

/**
 * Picks the right game component for `game` and renders it. The actual
 * modal chrome (backdrop, header, close) lives inside each game's
 * `<GameShell>` wrapper.
 */
export function GameModal({ game, onClose }: GameModalProps) {
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
    default:
      return null;
  }
}
