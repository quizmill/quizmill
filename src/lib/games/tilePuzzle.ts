/**
 * Sliding-tile puzzle state machine. 3×3 grid; tiles labelled 1..8 with
 * one blank (0). You tap a tile that's orthogonally adjacent to the blank
 * — they swap.
 *
 * Pure-data so the React component stays thin and the logic is
 * unit-testable.
 */

export type Board = readonly number[]; // length 9, values 0..8 with one 0

export const SIZE = 3;
export const SOLVED: Board = [1, 2, 3, 4, 5, 6, 7, 8, 0];

/** Find the index of the blank (0) cell. */
export function blankIndex(board: Board): number {
  return board.indexOf(0);
}

/** True iff the two indices are orthogonally adjacent on a 3×3 grid. */
export function isAdjacent(a: number, b: number): boolean {
  const ar = Math.floor(a / SIZE);
  const ac = a % SIZE;
  const br = Math.floor(b / SIZE);
  const bc = b % SIZE;
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}

/** Attempt to tap the tile at `index`. Returns a new board if the move
 *  is legal (tile is adjacent to blank), otherwise returns the original
 *  board unchanged. */
export function tapTile(board: Board, index: number): Board {
  const blank = blankIndex(board);
  if (!isAdjacent(index, blank)) return board;
  const next = board.slice();
  [next[index], next[blank]] = [next[blank], next[index]];
  return next;
}

/** Has the puzzle been solved? */
export function isSolved(board: Board): boolean {
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== SOLVED[i]) return false;
  }
  return true;
}

/**
 * Parity rule for the 3×3 puzzle: a permutation is solvable iff the
 * number of inversions among the non-blank tiles is even.
 */
function isSolvable(board: Board): boolean {
  let inversions = 0;
  const tiles = board.filter((v) => v !== 0);
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if (tiles[i] > tiles[j]) inversions += 1;
    }
  }
  return inversions % 2 === 0;
}

/**
 * Shuffle the solved board by walking some number of random LEGAL moves
 * away from solved. Walking from solved guarantees solvability and gives
 * us a "scramble difficulty" knob. 60 random moves is plenty for a 3×3
 * to feel genuinely shuffled while staying tractable.
 */
export function shuffle(
  rng: () => number = Math.random,
  moves: number = 60,
): Board {
  let board: Board = SOLVED.slice();
  let prevBlank = -1;
  for (let i = 0; i < moves; i++) {
    const blank = blankIndex(board);
    const candidates: number[] = [];
    for (let n = 0; n < 9; n++) {
      if (n === prevBlank) continue; // avoid undoing the last move
      if (isAdjacent(n, blank)) candidates.push(n);
    }
    const pick = candidates[Math.floor(rng() * candidates.length)];
    board = tapTile(board, pick);
    prevBlank = blank;
  }
  // It's possible (rare) we walked back to solved. Push once more if so.
  if (isSolved(board)) {
    const blank = blankIndex(board);
    const any = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((n) => isAdjacent(n, blank));
    if (any !== undefined) board = tapTile(board, any);
  }
  // Sanity: must be solvable (it always will be, since we walked from
  // solved using only legal moves).
  /* istanbul ignore next */
  if (!isSolvable(board)) {
    throw new Error('shuffled board is unsolvable — generator bug');
  }
  return board;
}
