/**
 * Pong physics — single-paddle player vs an AI on the right.
 *
 * Coordinates are normalised to 0..1 on both axes. Paddle X positions
 * are fixed (left paddle at PADDLE_X, right at 1 - PADDLE_X); paddle Y
 * is the centre of the paddle. The ball is a point with velocity
 * (vx, vy) per second.
 *
 * Game state is immutable; `step(state, dtSec)` returns the next state.
 */

export interface Vec {
  x: number;
  y: number;
}

export interface PongState {
  /** Position of the centre of each paddle, 0..1 on the Y axis. */
  playerY: number;
  aiY: number;
  /** Centre of the ball. */
  ball: Vec;
  /** Ball velocity in board-units per second. */
  vel: Vec;
  /** Round scores; first to WIN_SCORE wins. */
  playerScore: number;
  aiScore: number;
  /** Game is paused between points to let the kid see what happened. */
  paused: boolean;
  /** When non-null, the game is over and this side won. */
  winner: 'player' | 'ai' | null;
}

export const PADDLE_HALF_H = 0.09; // half the paddle height
export const PADDLE_X = 0.04; // paddle distance from each side
export const BALL_RADIUS = 0.015;
export const WIN_SCORE = 5;
/** AI paddle moves toward ball Y but capped — gives the kid a chance. */
export const AI_MAX_SPEED = 0.45; // board-units per second
const START_SPEED = 0.55;
const SPEED_RAMP = 1.05; // multiply ball speed each paddle hit

export function newGame(startDirection: 1 | -1 = 1): PongState {
  return {
    playerY: 0.5,
    aiY: 0.5,
    ball: { x: 0.5, y: 0.5 },
    vel: { x: START_SPEED * startDirection, y: (Math.random() - 0.5) * 0.4 },
    playerScore: 0,
    aiScore: 0,
    paused: false,
    winner: null,
  };
}

export function setPlayerY(state: PongState, y: number): PongState {
  if (state.winner) return state;
  return {
    ...state,
    playerY: Math.max(PADDLE_HALF_H, Math.min(1 - PADDLE_HALF_H, y)),
  };
}

/** Helper: did the ball just pass `paddleX` AND was it WITHIN the paddle's
 *  vertical span? Returns the new vy if so (bouncing English added), null
 *  otherwise. */
function paddleCollision(
  ball: Vec,
  paddleY: number,
  side: 'left' | 'right',
): number | null {
  if (Math.abs(ball.x - (side === 'left' ? PADDLE_X : 1 - PADDLE_X)) > BALL_RADIUS) {
    return null;
  }
  const dy = ball.y - paddleY;
  if (Math.abs(dy) > PADDLE_HALF_H) return null;
  // English: where the ball hits the paddle determines the new vy.
  // Centre = flat, edges = sharp.
  return dy * 4.5;
}

export function step(state: PongState, dtSec: number): PongState {
  if (state.winner) return state;
  let { ball, vel, aiY, playerY, playerScore, aiScore } = state;

  // Move ball.
  let nx = ball.x + vel.x * dtSec;
  let ny = ball.y + vel.y * dtSec;
  let nvx = vel.x;
  let nvy = vel.y;

  // Top/bottom walls — flip vy.
  if (ny < BALL_RADIUS) {
    ny = BALL_RADIUS;
    nvy = -nvy;
  } else if (ny > 1 - BALL_RADIUS) {
    ny = 1 - BALL_RADIUS;
    nvy = -nvy;
  }

  // Paddle hits.
  if (nvx < 0) {
    const eng = paddleCollision({ x: nx, y: ny }, playerY, 'left');
    if (eng !== null) {
      nx = PADDLE_X + BALL_RADIUS;
      nvx = -nvx * SPEED_RAMP;
      nvy = eng;
    }
  } else if (nvx > 0) {
    const eng = paddleCollision({ x: nx, y: ny }, aiY, 'right');
    if (eng !== null) {
      nx = 1 - PADDLE_X - BALL_RADIUS;
      nvx = -nvx * SPEED_RAMP;
      nvy = eng;
    }
  }

  // Score: ball went off LEFT (AI scores) or RIGHT (player scores).
  let winner: PongState['winner'] = null;
  let paused = false;
  if (nx < -BALL_RADIUS) {
    aiScore += 1;
    paused = true;
    if (aiScore >= WIN_SCORE) winner = 'ai';
  } else if (nx > 1 + BALL_RADIUS) {
    playerScore += 1;
    paused = true;
    if (playerScore >= WIN_SCORE) winner = 'player';
  }

  // AI: chase the ball but capped at AI_MAX_SPEED.
  const targetY = ny;
  const aiDelta = Math.max(
    -AI_MAX_SPEED * dtSec,
    Math.min(AI_MAX_SPEED * dtSec, targetY - aiY),
  );
  const newAiY = Math.max(
    PADDLE_HALF_H,
    Math.min(1 - PADDLE_HALF_H, aiY + aiDelta),
  );

  // If we just scored, recentre and pause until resume() is called.
  if (paused && !winner) {
    return {
      ...state,
      ball: { x: 0.5, y: 0.5 },
      vel: { x: -nvx > 0 ? START_SPEED : -START_SPEED, y: (Math.random() - 0.5) * 0.4 },
      playerScore,
      aiScore,
      aiY: 0.5,
      paused: true,
      winner: null,
    };
  }

  return {
    ...state,
    ball: { x: nx, y: ny },
    vel: { x: nvx, y: nvy },
    aiY: newAiY,
    playerScore,
    aiScore,
    paused: false,
    winner,
  };
}

/** Used to resume play after a between-point pause. */
export function resume(state: PongState): PongState {
  if (state.winner) return state;
  return { ...state, paused: false };
}
