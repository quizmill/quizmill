/**
 * Snake game state machine.
 *
 * Pure functions over an immutable `State` so the React component is
 * trivial and the logic is unit-testable without DOM. Coordinates are
 * `{ x, y }` cells on a square grid (origin top-left). The snake is an
 * array of segments with the head at index 0.
 */

export interface Cell {
  x: number;
  y: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface State {
  size: number; // grid is size×size cells
  snake: Cell[];
  direction: Direction;
  /** Buffered direction — applied on the next step. Lets us queue a
   *  90° turn without missing a tick. Prevents 180° reversals. */
  pendingDirection: Direction;
  food: Cell;
  score: number;
  gameOver: boolean;
}

const DIRS: Record<Direction, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export function newGame(size: number = 16, rng: () => number = Math.random): State {
  const mid = Math.floor(size / 2);
  const snake: Cell[] = [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ];
  return {
    size,
    snake,
    direction: 'right',
    pendingDirection: 'right',
    food: pickFood(snake, size, rng),
    score: 0,
    gameOver: false,
  };
}

function pickFood(snake: Cell[], size: number, rng: () => number): Cell {
  // Try random cells until we find one the snake isn't on. For small
  // grids this terminates quickly. For a "fully filled" grid (snake
  // covers everything) we just return the head — the game's basically
  // won at that point and the caller will handle game-over.
  const occupied = new Set(snake.map((c) => `${c.x},${c.y}`));
  for (let i = 0; i < 100; i++) {
    const f: Cell = {
      x: Math.floor(rng() * size),
      y: Math.floor(rng() * size),
    };
    if (!occupied.has(`${f.x},${f.y}`)) return f;
  }
  // Fallback: scan deterministically.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!occupied.has(`${x},${y}`)) return { x, y };
    }
  }
  return snake[0];
}

/** Apply a direction input. Ignored if it's a 180° reversal. */
export function steer(state: State, next: Direction): State {
  if (state.gameOver) return state;
  if (OPPOSITE[state.direction] === next) return state;
  return { ...state, pendingDirection: next };
}

/** Advance one tick. */
export function step(state: State, rng: () => number = Math.random): State {
  if (state.gameOver) return state;

  const direction = state.pendingDirection;
  const delta = DIRS[direction];
  const head = state.snake[0];
  const newHead: Cell = { x: head.x + delta.x, y: head.y + delta.y };

  // Wall collision.
  if (
    newHead.x < 0 ||
    newHead.x >= state.size ||
    newHead.y < 0 ||
    newHead.y >= state.size
  ) {
    return { ...state, direction, gameOver: true };
  }

  const ate = newHead.x === state.food.x && newHead.y === state.food.y;
  const newSnake = [newHead, ...state.snake];
  if (!ate) newSnake.pop();

  // Self collision (after the move). When NOT eating we already popped
  // the tail, so the tail cell is free — checking against the new
  // snake is correct.
  const occupied = new Set(newSnake.slice(1).map((c) => `${c.x},${c.y}`));
  if (occupied.has(`${newHead.x},${newHead.y}`)) {
    return {
      ...state,
      direction,
      snake: newSnake,
      gameOver: true,
    };
  }

  return {
    ...state,
    direction,
    pendingDirection: direction,
    snake: newSnake,
    food: ate ? pickFood(newSnake, state.size, rng) : state.food,
    score: ate ? state.score + 1 : state.score,
  };
}
