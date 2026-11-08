import { describe, expect, it } from 'vitest';
import {
  COLS,
  LINE_POINTS,
  PIECE_KINDS,
  ROWS,
  SHAPES,
  cellsOf,
  collides,
  dropIntervalMs,
  emptyBoard,
  hardDrop,
  levelFor,
  lock,
  moveLeft,
  moveRight,
  newGame,
  rotate,
  softDrop,
  spawnPiece,
  tick,
  type BoardCell,
  type State,
} from '../src/lib/games/tetris';

// Deterministic LCG so piece order is reproducible.
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** A state with a chosen falling piece over a chosen board. */
function staged(
  board: BoardCell[][],
  current: State['current'],
  extra: Partial<State> = {},
): State {
  return { ...newGame(lcg(1)), board, current, ...extra };
}

/** A board whose bottom `rows` rows are full except column `gap`. */
function wellBoard(rows: number, gap: number): BoardCell[][] {
  const board = emptyBoard();
  for (let y = ROWS - rows; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) if (x !== gap) board[y][x] = 'J';
  }
  return board;
}

describe('tetris shapes', () => {
  it('every piece has four orientations of four cells', () => {
    for (const kind of PIECE_KINDS) {
      expect(SHAPES[kind]).toHaveLength(4);
      for (const rot of SHAPES[kind]) expect(rot).toHaveLength(4);
    }
  });

  it('the O piece looks the same whichever way it turns', () => {
    const key = (cells: readonly { x: number; y: number }[]) =>
      cells.map((c) => `${c.x},${c.y}`).sort().join(' ');
    const base = key(SHAPES.O[0]);
    for (const rot of SHAPES.O) expect(key(rot)).toBe(base);
  });

  it('spawns every piece centred with its top row on row 0', () => {
    for (const kind of PIECE_KINDS) {
      const cells = cellsOf(spawnPiece(kind));
      expect(Math.min(...cells.map((c) => c.y))).toBe(0);
      const minX = Math.min(...cells.map((c) => c.x));
      const maxX = Math.max(...cells.map((c) => c.x));
      // Within a cell of the middle either side.
      expect(minX).toBeGreaterThanOrEqual(3);
      expect(maxX).toBeLessThanOrEqual(6);
    }
  });
});

describe('tetris piece order', () => {
  it('deals each of the seven kinds once before repeating (7-bag)', () => {
    let s = newGame(lcg(7));
    const kinds = [s.current.kind, s.next];
    for (let i = 0; i < 5; i++) {
      s = hardDrop(s, lcg(i));
      kinds.push(s.next);
    }
    expect([...kinds].sort()).toEqual([...PIECE_KINDS].sort());
  });

  it('starts with an empty board, no score and no game over', () => {
    const s = newGame(lcg(3));
    expect(s.board.flat().every((c) => c === null)).toBe(true);
    expect(s.score).toBe(0);
    expect(s.lines).toBe(0);
    expect(s.gameOver).toBe(false);
  });
});

describe('tetris movement', () => {
  it('moves sideways until the wall, then stays put', () => {
    let s = newGame(lcg(2));
    for (let i = 0; i < COLS; i++) s = moveLeft(s);
    expect(Math.min(...cellsOf(s.current).map((c) => c.x))).toBe(0);
    expect(moveLeft(s)).toBe(s);
    for (let i = 0; i < COLS; i++) s = moveRight(s);
    expect(Math.max(...cellsOf(s.current).map((c) => c.x))).toBe(COLS - 1);
    expect(moveRight(s)).toBe(s);
  });

  it('rotating four times comes back round; O never turns', () => {
    const t = staged(emptyBoard(), spawnPiece('T'));
    let s = t;
    for (let i = 0; i < 4; i++) s = rotate(s);
    expect(s.current).toEqual(t.current);
    expect(rotate(t).current.rotation).toBe(1);

    const o = staged(emptyBoard(), spawnPiece('O'));
    expect(rotate(o)).toBe(o);
  });

  it('kicks off the wall so a piece hugging the edge can still turn', () => {
    // A vertical I flush against the right wall: turning it flat needs
    // a nudge left or it would poke through the wall.
    let s = staged(emptyBoard(), { kind: 'I', rotation: 1, x: COLS - 3, y: 2 });
    expect(Math.max(...cellsOf(s.current).map((c) => c.x))).toBe(COLS - 1);
    s = rotate(s);
    expect(s.current.rotation).toBe(2);
    expect(collides(s.board, s.current)).toBe(false);
  });

  it('refuses a rotation that fits nowhere', () => {
    // Walled in on both sides, a vertical I has no room to go flat.
    const board = emptyBoard();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) if (x !== 5) board[y][x] = 'J';
    }
    const s = staged(board, { kind: 'I', rotation: 1, x: 3, y: 2 });
    expect(collides(board, s.current)).toBe(false);
    expect(rotate(s)).toBe(s);
  });
});

describe('tetris gravity and locking', () => {
  it('a tick drops the piece one row', () => {
    const s = newGame(lcg(5));
    expect(tick(s, lcg(0)).current.y).toBe(s.current.y + 1);
  });

  it('a tick on a resting piece locks it and spawns the next', () => {
    const resting = staged(emptyBoard(), { kind: 'O', rotation: 0, x: 4, y: ROWS - 2 });
    const s = tick(resting, lcg(0));
    expect(s.board[ROWS - 1][4]).toBe('O');
    expect(s.board[ROWS - 1][5]).toBe('O');
    expect(s.board[ROWS - 2][4]).toBe('O');
    expect(s.current.kind).toBe(resting.next);
    expect(s.current.y).toBe(spawnPiece(resting.next).y);
    expect(s.gameOver).toBe(false);
  });

  it('soft drop scores a point per row and locks when it cannot fall', () => {
    const s = newGame(lcg(5));
    const dropped = softDrop(s, lcg(0));
    expect(dropped.current.y).toBe(s.current.y + 1);
    expect(dropped.score).toBe(1);

    const resting = staged(emptyBoard(), { kind: 'O', rotation: 0, x: 4, y: ROWS - 2 });
    expect(softDrop(resting, lcg(0)).board[ROWS - 1][4]).toBe('O');
  });

  it('hard drop slams to the floor for two points a row', () => {
    const s = staged(emptyBoard(), { kind: 'O', rotation: 0, x: 4, y: 0 });
    const d = hardDrop(s, lcg(0));
    // The O fell from rows 0–1 to rows 18–19: eighteen rows.
    expect(d.board[ROWS - 1][4]).toBe('O');
    expect(d.board[ROWS - 2][5]).toBe('O');
    expect(d.score).toBe(18 * 2);
    expect(d.lines).toBe(0);
  });
});

describe('tetris lines and scoring', () => {
  it('clears a full row, drops the rest down and scores it at the level', () => {
    // One row short of full at the bottom; an O over the gap fills it
    // (and leaves its top half behind on the row above).
    const board = wellBoard(1, 4);
    board[ROWS - 1][5] = null;
    const s = staged(board, { kind: 'O', rotation: 0, x: 4, y: 0 });
    const d = hardDrop(s, lcg(0));
    expect(d.lines).toBe(1);
    expect(d.score).toBe(LINE_POINTS[1] + 18 * 2);
    // What was the bottom row is gone; the O's top half is now the bottom.
    expect(d.board[ROWS - 1].filter((c) => c !== null)).toEqual(['O', 'O']);
    expect(d.board[ROWS - 2].every((c) => c === null)).toBe(true);
  });

  it('a vertical I down a four-deep well scores a tetris', () => {
    const s = staged(wellBoard(4, 9), { kind: 'I', rotation: 1, x: 7, y: 0 });
    const d = hardDrop(s, lcg(0));
    expect(d.lines).toBe(4);
    expect(d.score).toBe(LINE_POINTS[4] + 16 * 2);
    expect(d.board.flat().every((c) => c === null)).toBe(true);
  });

  it('multiplies line points by the level in force before the clear', () => {
    // A vertical I resting in the well, twenty lines already cleared.
    const s = staged(
      wellBoard(1, 4),
      { kind: 'I', rotation: 1, x: 2, y: ROWS - 4 },
      { lines: 20 },
    );
    expect(collides(s.board, s.current)).toBe(false);
    expect(levelFor(s.lines)).toBe(3);
    const d = lock(s, lcg(0));
    expect(d.lines).toBe(21);
    expect(d.score).toBe(LINE_POINTS[1] * 3);
  });

  it('levels up every ten lines and speeds the fall, with a floor', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(9)).toBe(1);
    expect(levelFor(10)).toBe(2);
    expect(levelFor(35)).toBe(4);
    expect(dropIntervalMs(1)).toBe(1000);
    expect(dropIntervalMs(2)).toBe(800);
    expect(dropIntervalMs(3)).toBeLessThan(dropIntervalMs(2));
    expect(dropIntervalMs(50)).toBe(120);
  });
});

describe('tetris game over', () => {
  it('ends when the next piece has no room, and then ignores input', () => {
    // Stacked up to row 1, column 0 left open the whole way so no row
    // ever clears: the T that spawns next lands on a locked cell.
    const board = emptyBoard();
    for (let y = 1; y < ROWS; y++) for (let x = 1; x < COLS; x++) board[y][x] = 'J';
    board[1][4] = null;
    board[1][5] = null;
    const s = staged(board, { kind: 'O', rotation: 0, x: 4, y: 0 }, { next: 'T' });
    const over = tick(s, lcg(0));
    expect(over.gameOver).toBe(true);
    expect(moveLeft(over)).toBe(over);
    expect(rotate(over)).toBe(over);
    expect(tick(over, lcg(0))).toBe(over);
    expect(hardDrop(over, lcg(0))).toBe(over);
  });
});
