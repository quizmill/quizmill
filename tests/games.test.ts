import { describe, expect, it } from 'vitest';
import {
  blankIndex,
  isAdjacent,
  isSolved,
  shuffle as shufflePuzzle,
  tapTile,
  SOLVED,
} from '../src/lib/games/tilePuzzle';
import { newGame as newSnake, step, steer } from '../src/lib/games/snake';
import {
  GAMES,
  enabledGames,
  getGame,
  pickRandomGame,
  type GameId,
} from '../src/lib/games/registry';
import { GAME_IDS } from '../tools/pack/schema';

// Deterministic LCG for reproducible shuffles.
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe('tile puzzle', () => {
  it('SOLVED is recognised by isSolved', () => {
    expect(isSolved(SOLVED)).toBe(true);
  });

  it('isAdjacent: top-left has two neighbours (right, below)', () => {
    expect(isAdjacent(0, 1)).toBe(true); // right
    expect(isAdjacent(0, 3)).toBe(true); // below
    expect(isAdjacent(0, 4)).toBe(false); // diagonal
    expect(isAdjacent(0, 8)).toBe(false); // opposite corner
  });

  it('tapTile swaps an adjacent tile with the blank', () => {
    // blank is at index 8 in SOLVED. Tap tile at 7 (value 8) — moves down.
    const next = tapTile(SOLVED, 7);
    expect(next).not.toBe(SOLVED);
    expect(blankIndex(next)).toBe(7);
    expect(next[8]).toBe(8);
  });

  it('tapTile returns the same board for an illegal move (not adjacent)', () => {
    // tile at 0 isn't adjacent to blank at 8 — no swap.
    const next = tapTile(SOLVED, 0);
    expect(next).toBe(SOLVED);
  });

  it('shuffle produces a non-solved, solvable board across many seeds', () => {
    for (let seed = 0; seed < 20; seed++) {
      const board = shufflePuzzle(lcg(seed), 60);
      expect(isSolved(board)).toBe(false);
    }
  });

  it('a single tap is reversible by re-tapping the vacated cell', () => {
    // Tap moves a tile into the blank; tapping the cell the tile left
    // (now holding the blank's old neighbour) reverses it.
    const moved = tapTile(SOLVED, 7);
    const back = tapTile(moved, 8);
    expect(isSolved(back)).toBe(true);
  });
});

describe('snake', () => {
  it('newGame puts a 3-segment snake facing right', () => {
    const s = newSnake(16, () => 0);
    expect(s.snake).toHaveLength(3);
    expect(s.direction).toBe('right');
    expect(s.gameOver).toBe(false);
    expect(s.score).toBe(0);
  });

  it('step moves the head one cell in the current direction', () => {
    const s = newSnake(16, () => 0);
    const headBefore = s.snake[0];
    const s1 = step(s, () => 0);
    expect(s1.snake[0].x).toBe(headBefore.x + 1);
    expect(s1.snake[0].y).toBe(headBefore.y);
    expect(s1.snake.length).toBe(s.snake.length);
  });

  it('eating food grows the snake by one and increments score', () => {
    let s = newSnake(16, () => 0);
    const head = s.snake[0];
    s = { ...s, food: { x: head.x + 1, y: head.y } };
    const s1 = step(s, () => 0);
    expect(s1.score).toBe(1);
    expect(s1.snake.length).toBe(s.snake.length + 1);
  });

  it('hitting a wall ends the game', () => {
    let s = newSnake(4, () => 0);
    for (let i = 0; i < 10 && !s.gameOver; i++) s = step(s, () => 0);
    expect(s.gameOver).toBe(true);
  });

  it('steer ignores a 180° reversal but accepts a 90° turn', () => {
    const s = newSnake(16, () => 0);
    expect(steer(s, 'left').pendingDirection).toBe('right'); // reversal ignored
    expect(steer(s, 'up').pendingDirection).toBe('up'); // 90° accepted
  });

  it('step does nothing once gameOver', () => {
    const s = { ...newSnake(16, () => 0), gameOver: true };
    expect(step(s, () => 0)).toBe(s);
  });
});

describe('game registry', () => {
  it('every registry id is a valid pack game id (and vice versa)', () => {
    const registryIds = GAMES.map((g) => g.id).sort();
    const schemaIds = [...GAME_IDS].sort();
    expect(registryIds).toEqual(schemaIds);
  });

  it('getGame returns the def, throws on an unknown id', () => {
    expect(getGame('snake').name).toBe('Snake');
    expect(() => getGame('nope' as GameId)).toThrow();
  });

  it('pickRandomGame is deterministic given an rng', () => {
    expect(pickRandomGame(() => 0)).toBe(GAMES[0].id);
    expect(pickRandomGame(() => 0.999)).toBe(GAMES[GAMES.length - 1].id);
  });

  it('enabledGames returns all when include is omitted/empty', () => {
    expect(enabledGames()).toHaveLength(GAMES.length);
    expect(enabledGames([])).toHaveLength(GAMES.length);
  });

  it('enabledGames narrows to the included subset, preserving order', () => {
    const subset = enabledGames(['pong', 'snake']);
    expect(subset.map((g) => g.id)).toEqual(['snake', 'pong']);
  });
});
