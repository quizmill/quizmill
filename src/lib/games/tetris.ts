/**
 * Tetris state machine.
 *
 * Pure functions over an immutable `State` so the React component is a
 * thin shell and the rules are unit-testable without DOM. The board is
 * `ROWS` × `COLS` cells, row 0 at the top; a cell holds the kind of the
 * piece that locked there (its colour) or null. The falling piece is kept
 * separately as kind + rotation + position and merged in on lock.
 *
 * Every function that may spawn a piece takes an `rng` (0 ≤ r < 1) so
 * tests can drive the piece order; the component passes Math.random.
 * Pieces come from the classic "7-bag": each kind once per bag, in a
 * random order, so a drought of the I piece can't last longer than 12.
 */

export const COLS = 10;
export const ROWS = 20;

export type PieceKind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const PIECE_KINDS: readonly PieceKind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export type Rotation = 0 | 1 | 2 | 3;

export interface Cell {
  x: number;
  y: number;
}

export interface Piece {
  kind: PieceKind;
  rotation: Rotation;
  /** Top-left of the piece's bounding grid on the board (may be off-board). */
  x: number;
  y: number;
}

/** A board cell: the kind that locked there, or empty. */
export type BoardCell = PieceKind | null;

export interface State {
  board: BoardCell[][];
  current: Piece;
  next: PieceKind;
  /** The rest of the current 7-bag; refilled (shuffled) when empty. */
  bag: PieceKind[];
  score: number;
  lines: number;
  gameOver: boolean;
}

/** Base orientation of each piece as a square grid (SRS layout). The
 *  other three rotations are this grid turned clockwise 1–3 times. */
const BASE: Record<PieceKind, number[][]> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

function rotateGrid(grid: number[][]): number[][] {
  const n = grid.length;
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => grid[n - 1 - c][r]),
  );
}

function gridCells(grid: number[][]): Cell[] {
  const cells: Cell[] = [];
  grid.forEach((row, y) =>
    row.forEach((v, x) => {
      if (v) cells.push({ x, y });
    }),
  );
  return cells;
}

/** `SHAPES[kind][rotation]` — the filled cells of that orientation,
 *  relative to the piece's bounding grid. */
export const SHAPES: Record<PieceKind, readonly (readonly Cell[])[]> = (() => {
  const out = {} as Record<PieceKind, Cell[][]>;
  for (const kind of PIECE_KINDS) {
    let grid = BASE[kind];
    const rots: Cell[][] = [];
    for (let r = 0; r < 4; r++) {
      rots.push(gridCells(grid));
      grid = rotateGrid(grid);
    }
    out[kind] = rots;
  }
  return out;
})();

/** Absolute board cells covered by `piece`. */
export function cellsOf(piece: Piece): Cell[] {
  return SHAPES[piece.kind][piece.rotation].map((c) => ({
    x: piece.x + c.x,
    y: piece.y + c.y,
  }));
}

export function emptyBoard(): BoardCell[][] {
  return Array.from({ length: ROWS }, () => Array<BoardCell>(COLS).fill(null));
}

/** True when any cell of `piece` is outside the walls/floor or on a
 *  locked cell. Cells above the top (y < 0) are allowed — a piece spawns
 *  partly hidden and can be rotated up there. */
export function collides(board: BoardCell[][], piece: Piece): boolean {
  return cellsOf(piece).some(
    (c) =>
      c.x < 0 ||
      c.x >= COLS ||
      c.y >= ROWS ||
      (c.y >= 0 && board[c.y][c.x] !== null),
  );
}

/** Where a fresh piece of `kind` appears: centred, its topmost filled
 *  row on row 0. */
export function spawnPiece(kind: PieceKind): Piece {
  const size = BASE[kind].length;
  const topFilled = Math.min(...SHAPES[kind][0].map((c) => c.y));
  return {
    kind,
    rotation: 0,
    x: Math.floor((COLS - size) / 2),
    y: -topFilled,
  };
}

/** Fisher–Yates over a fresh bag of the seven kinds. */
function shuffledBag(rng: () => number): PieceKind[] {
  const bag = [...PIECE_KINDS];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function draw(bag: PieceKind[], rng: () => number): [PieceKind, PieceKind[]] {
  const source = bag.length > 0 ? bag : shuffledBag(rng);
  return [source[0], source.slice(1)];
}

export function newGame(rng: () => number = Math.random): State {
  const [first, bag1] = draw([], rng);
  const [next, bag2] = draw(bag1, rng);
  return {
    board: emptyBoard(),
    current: spawnPiece(first),
    next,
    bag: bag2,
    score: 0,
    lines: 0,
    gameOver: false,
  };
}

/** Level 1 for the first ten lines, 2 for the next ten, and so on. */
export function levelFor(lines: number): number {
  return 1 + Math.floor(lines / 10);
}

/** Gravity interval. Starts at a brisk 700 ms a row — slow enough to
 *  learn on, fast enough not to drag — and speeds up a fifth per level,
 *  floored so a long game stays playable on a phone. */
export function dropIntervalMs(level: number): number {
  return Math.max(100, Math.round(700 * Math.pow(0.8, level - 1)));
}

/** Points for clearing `n` rows at once, before the level multiplier —
 *  the classic ladder that rewards a tetris over four singles. */
export const LINE_POINTS: Record<number, number> = { 1: 100, 2: 300, 3: 500, 4: 800 };

function tryMove(state: State, dx: number, dy: number): State | null {
  const moved = { ...state.current, x: state.current.x + dx, y: state.current.y + dy };
  return collides(state.board, moved) ? null : { ...state, current: moved };
}

export function moveLeft(state: State): State {
  if (state.gameOver) return state;
  return tryMove(state, -1, 0) ?? state;
}

export function moveRight(state: State): State {
  if (state.gameOver) return state;
  return tryMove(state, 1, 0) ?? state;
}

/** Sideways nudges tried, in order, when a rotation doesn't fit in place
 *  — enough of a wall kick to turn a piece hugging the edge. */
const KICKS = [0, -1, 1, -2, 2];

/** Rotate clockwise, kicking off a wall if needed. No-op if it can't fit. */
export function rotate(state: State): State {
  if (state.gameOver || state.current.kind === 'O') return state;
  const rotation = ((state.current.rotation + 1) % 4) as Rotation;
  for (const dx of KICKS) {
    const turned = { ...state.current, rotation, x: state.current.x + dx };
    if (!collides(state.board, turned)) return { ...state, current: turned };
  }
  return state;
}

/** Merge the falling piece into the board, clear full rows, score them
 *  and spawn the next piece. Game over when the new piece has no room, or
 *  when the piece locked with any cell still above the top ("lock out") —
 *  the board has no hidden rows, so that cell would otherwise vanish. */
export function lock(state: State, rng: () => number = Math.random): State {
  const board = state.board.map((row) => [...row]);
  let lockedOut = false;
  for (const c of cellsOf(state.current)) {
    if (c.y >= 0) board[c.y][c.x] = state.current.kind;
    else lockedOut = true;
  }
  const kept = board.filter((row) => row.some((cell) => cell === null));
  const cleared = ROWS - kept.length;
  while (kept.length < ROWS) kept.unshift(Array<BoardCell>(COLS).fill(null));

  const lines = state.lines + cleared;
  const score =
    state.score + (cleared > 0 ? (LINE_POINTS[cleared] ?? 0) * levelFor(state.lines) : 0);

  const current = spawnPiece(state.next);
  const [next, bag] = draw(state.bag, rng);
  return {
    board: kept,
    current,
    next,
    bag,
    score,
    lines,
    gameOver: lockedOut || collides(kept, current),
  };
}

/** One gravity step: fall a row, or lock if resting. */
export function tick(state: State, rng: () => number = Math.random): State {
  if (state.gameOver) return state;
  return tryMove(state, 0, 1) ?? lock(state, rng);
}

/** Player-driven fall: like a tick, plus a point for the hurry. */
export function softDrop(state: State, rng: () => number = Math.random): State {
  if (state.gameOver) return state;
  const moved = tryMove(state, 0, 1);
  return moved ? { ...moved, score: moved.score + 1 } : lock(state, rng);
}

/** Slam the piece to the floor and lock it: two points per row fallen. */
export function hardDrop(state: State, rng: () => number = Math.random): State {
  if (state.gameOver) return state;
  let s = state;
  let rows = 0;
  for (;;) {
    const moved = tryMove(s, 0, 1);
    if (!moved) break;
    s = moved;
    rows += 1;
  }
  return lock({ ...s, score: s.score + rows * 2 }, rng);
}
