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
  newGame as newPong,
  resume,
  setPlayerY,
  step as stepPong,
  BALL_RADIUS,
  PADDLE_HALF_H,
  PADDLE_X,
  WIN_SCORE,
  type PongState,
} from '../src/lib/games/pong';
import { GAMES, enabledGames } from '../src/lib/games/registry';
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

describe('pong', () => {
  // Serve angle = (rng() - 0.5) * 0.4, so rng → 1 pins vy to +0.2 and
  // rng → 0.5 pins it flat; a counting rng checks the serve draws ONCE.
  function counting(value: number): { rng: () => number; calls: () => number } {
    let n = 0;
    return {
      rng: () => {
        n++;
        return value;
      },
      calls: () => n,
    };
  }

  it('newGame serves from the centre with an rng-chosen angle', () => {
    const { rng, calls } = counting(1);
    const s = newPong(1, rng);
    expect(s.ball).toEqual({ x: 0.5, y: 0.5 });
    expect(s.vel.x).toBeGreaterThan(0);
    expect(s.vel.y).toBeCloseTo(0.2);
    expect(calls()).toBe(1);
    expect(s.playerScore).toBe(0);
    expect(s.aiScore).toBe(0);
    expect(s.paused).toBe(false);
    expect(s.winner).toBeNull();
  });

  it('newGame honours the start direction and is reproducible for the same rng', () => {
    expect(newPong(-1, () => 0.5).vel.x).toBeLessThan(0);
    expect(newPong(1, () => 0.25)).toEqual(newPong(1, () => 0.25));
  });

  it('step moves the ball by velocity × dt and chases it with the AI paddle', () => {
    const s = newPong(1, () => 0.5); // vy = 0: a flat serve to the right
    const s1 = stepPong(s, 0.1, () => 0.5);
    expect(s1.ball.x).toBeCloseTo(0.5 + s.vel.x * 0.1);
    expect(s1.ball.y).toBeCloseTo(0.5);
    expect(s1.aiY).toBeCloseTo(0.5); // already level with the ball
    expect(s1.paused).toBe(false);
  });

  it('bounces off the top and bottom walls', () => {
    const s: PongState = {
      ...newPong(1, () => 0.5),
      ball: { x: 0.5, y: BALL_RADIUS + 0.01 },
      vel: { x: 0, y: -1 },
    };
    const s1 = stepPong(s, 0.1, () => 0.5);
    expect(s1.ball.y).toBeCloseTo(BALL_RADIUS);
    expect(s1.vel.y).toBe(1);
  });

  it('a paddle hit reflects the ball, speeds it up and adds English', () => {
    // Ball just right of the player paddle, heading left, paddle centred
    // slightly below the ball so the return angles up.
    const s: PongState = {
      ...newPong(-1, () => 0.5),
      playerY: 0.52,
      ball: { x: PADDLE_X + BALL_RADIUS + 0.005, y: 0.5 },
      vel: { x: -0.5, y: 0 },
    };
    const s1 = stepPong(s, 0.02, () => 0.5);
    expect(s1.vel.x).toBeCloseTo(0.5 * 1.05);
    expect(s1.vel.y).toBeCloseTo((0.5 - 0.52) * 4.5);
    expect(s1.ball.x).toBeCloseTo(PADDLE_X + BALL_RADIUS);
    expect(s1.playerScore).toBe(0);
    expect(s1.aiScore).toBe(0);
  });

  it('a miss on the left scores for the AI, pauses, and re-serves from the centre with an rng angle', () => {
    const s: PongState = {
      ...newPong(-1, () => 0.5),
      ball: { x: 0.01, y: 0.3 },
      vel: { x: -1, y: 0.1 },
      aiY: 0.8,
    };
    const { rng, calls } = counting(1);
    const s1 = stepPong(s, 0.1, rng);
    expect(s1.aiScore).toBe(1);
    expect(s1.playerScore).toBe(0);
    expect(s1.paused).toBe(true);
    expect(s1.winner).toBeNull();
    expect(s1.ball).toEqual({ x: 0.5, y: 0.5 });
    expect(s1.aiY).toBe(0.5);
    expect(s1.vel.x).toBeGreaterThan(0); // serves back toward the AI side
    expect(s1.vel.y).toBeCloseTo(0.2);
    expect(calls()).toBe(1);
  });

  it('a miss on the right scores for the player and serves toward the player', () => {
    const s: PongState = {
      ...newPong(1, () => 0.5),
      ball: { x: 0.99, y: 0.5 },
      vel: { x: 1, y: 0 },
    };
    const s1 = stepPong(s, 0.1, () => 0.5);
    expect(s1.playerScore).toBe(1);
    expect(s1.paused).toBe(true);
    expect(s1.vel.x).toBeLessThan(0);
    expect(s1.vel.y).toBeCloseTo(0);
  });

  it('the same rng gives the same re-serve every time', () => {
    const s: PongState = {
      ...newPong(1, () => 0.5),
      ball: { x: 0.99, y: 0.5 },
      vel: { x: 1, y: 0 },
    };
    expect(stepPong(s, 0.1, () => 0.9)).toEqual(stepPong(s, 0.1, () => 0.9));
    expect(stepPong(s, 0.1, () => 0.9).vel.y).not.toBeCloseTo(
      stepPong(s, 0.1, () => 0.1).vel.y,
    );
  });

  it('the winning point ends the game without a re-serve', () => {
    const s: PongState = {
      ...newPong(1, () => 0.5),
      playerScore: WIN_SCORE - 1,
      ball: { x: 0.99, y: 0.5 },
      vel: { x: 1, y: 0 },
    };
    const { rng, calls } = counting(0.5);
    const s1 = stepPong(s, 0.1, rng);
    expect(s1.winner).toBe('player');
    expect(s1.playerScore).toBe(WIN_SCORE);
    expect(s1.paused).toBe(false);
    expect(calls()).toBe(0);
    // A finished game is inert.
    expect(stepPong(s1, 0.1, rng)).toBe(s1);
    expect(resume(s1)).toBe(s1);
    expect(setPlayerY(s1, 0.1)).toBe(s1);
  });

  it('resume clears the between-point pause', () => {
    const paused = { ...newPong(1, () => 0.5), paused: true };
    expect(resume(paused).paused).toBe(false);
  });

  it('setPlayerY clamps the paddle to the board', () => {
    const s = newPong(1, () => 0.5);
    expect(setPlayerY(s, -1).playerY).toBe(PADDLE_HALF_H);
    expect(setPlayerY(s, 2).playerY).toBe(1 - PADDLE_HALF_H);
    expect(setPlayerY(s, 0.3).playerY).toBe(0.3);
  });
});

describe('game registry', () => {
  it('every registry id is a valid pack game id (and vice versa)', () => {
    const registryIds = GAMES.map((g) => g.id).sort();
    const schemaIds = [...GAME_IDS].sort();
    expect(registryIds).toEqual(schemaIds);
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
