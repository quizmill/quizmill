'use client';

import { useEffect, useState } from 'react';
import { GameOver } from './GameOver';
import { GameShell } from './GameShell';
import { HowToPlay } from './HowToPlay';
import {
  COLS,
  ROWS,
  SHAPES,
  cellsOf,
  dropIntervalMs,
  hardDrop,
  levelFor,
  moveLeft,
  moveRight,
  newGame,
  rotate,
  softDrop,
  tick,
  type PieceKind,
  type State,
} from '@/lib/games/tetris';

interface TetrisProps {
  onClose: () => void;
}

/** The classic colour per piece — recognisable to anyone who has played. */
const COLOURS: Record<PieceKind, string> = {
  I: '#06b6d4',
  O: '#eab308',
  T: '#a855f7',
  S: '#22c55e',
  Z: '#ef4444',
  J: '#3b82f6',
  L: '#f97316',
};

const BOARD_BG = '#f1f5f9'; // ink-100, as the Snake board
const PREVIEW = 4; // the next-piece box is PREVIEW×PREVIEW cells

const PAD_BUTTON =
  'tap-feedback flex h-14 items-center justify-center rounded-xl bg-ink-100 text-2xl font-bold text-ink-700 hover:bg-ink-200 active:bg-ink-300 disabled:opacity-40 disabled:hover:bg-ink-100';

export function Tetris({ onClose }: TetrisProps) {
  const [state, setState] = useState<State>(() => newGame());
  const level = levelFor(state.lines);

  // Gravity. The interval shortens with the level, so the loop restarts
  // whenever the level changes (and stops at game over).
  useEffect(() => {
    if (state.gameOver) return;
    const id = setInterval(() => setState((s) => tick(s)), dropIntervalMs(level));
    return () => clearInterval(id);
  }, [state.gameOver, level]);

  // Keyboard controls — arrows (or WASD), space to hard-drop. Listening
  // only while a game is on, so at game over Space and the arrows go back
  // to the page (activating Done / Play again, scrolling).
  useEffect(() => {
    if (state.gameOver) return;
    function onKey(e: KeyboardEvent) {
      // Space on a focused control (Close, How to play, the pad) keeps its
      // native activation rather than becoming a hard drop.
      if (
        e.key === ' ' &&
        e.target instanceof Element &&
        e.target.closest('button, a, input, select, textarea, summary, [role="button"]')
      ) {
        return;
      }
      const actions: Record<string, ((s: State) => State) | undefined> = {
        ArrowLeft: moveLeft,
        a: moveLeft,
        ArrowRight: moveRight,
        d: moveRight,
        ArrowUp: rotate,
        w: rotate,
        x: rotate,
        ArrowDown: (s) => softDrop(s),
        s: (s) => softDrop(s),
        ' ': (s) => hardDrop(s),
      };
      const action = actions[e.key];
      if (!action) return;
      e.preventDefault();
      setState(action);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.gameOver]);

  function handleRestart() {
    setState(newGame());
  }

  // The next piece, centred in its preview box.
  const nextCells = SHAPES[state.next][0];
  const minX = Math.min(...nextCells.map((c) => c.x));
  const maxX = Math.max(...nextCells.map((c) => c.x));
  const minY = Math.min(...nextCells.map((c) => c.y));
  const maxY = Math.max(...nextCells.map((c) => c.y));
  const offX = (PREVIEW - (maxX - minX + 1)) / 2 - minX;
  const offY = (PREVIEW - (maxY - minY + 1)) / 2 - minY;

  const falling = state.gameOver ? [] : cellsOf(state.current).filter((c) => c.y >= 0);

  return (
    <GameShell
      title="Tetris"
      emoji="🧱"
      onClose={onClose}
      status={
        <div className="flex items-center justify-between">
          <span>
            Score:{' '}
            <span className="font-semibold text-ink-900" data-testid="tetris-score">
              {state.score}
            </span>
          </span>
          {state.gameOver ? (
            <span className="font-semibold text-warn-700">Game over</span>
          ) : (
            <span className="text-xs text-ink-500">Tap the pad or use arrow keys</span>
          )}
        </div>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <div className="flex w-full items-start justify-center gap-4">
          <svg
            data-testid="tetris-board"
            viewBox={`0 0 ${COLS} ${ROWS}`}
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Tetris board"
            className="block w-[180px] shrink-0 select-none rounded-xl border border-ink-200"
            style={{ background: BOARD_BG, aspectRatio: `${COLS} / ${ROWS}` }}
          >
            {state.board.map((row, y) =>
              row.map((cell, x) =>
                cell ? (
                  <rect
                    key={`${x}-${y}`}
                    x={x + 0.05}
                    y={y + 0.05}
                    width={0.9}
                    height={0.9}
                    rx={0.12}
                    fill={COLOURS[cell]}
                  />
                ) : null,
              ),
            )}
            {falling.map((c) => (
              <rect
                key={`p-${c.x}-${c.y}`}
                x={c.x + 0.05}
                y={c.y + 0.05}
                width={0.9}
                height={0.9}
                rx={0.12}
                fill={COLOURS[state.current.kind]}
                stroke="rgba(255,255,255,0.6)"
                strokeWidth={0.06}
              />
            ))}
          </svg>

          <div className="flex flex-col gap-3 text-sm text-ink-600">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                Next
              </div>
              <svg
                data-testid="tetris-next"
                viewBox={`0 0 ${PREVIEW} ${PREVIEW}`}
                xmlns="http://www.w3.org/2000/svg"
                role="img"
                aria-label={`Next piece: ${state.next}`}
                className="mt-1 block h-16 w-16 rounded-lg border border-ink-200"
                style={{ background: BOARD_BG }}
              >
                {nextCells.map((c) => (
                  <rect
                    key={`${c.x}-${c.y}`}
                    x={c.x + offX + 0.05}
                    y={c.y + offY + 0.05}
                    width={0.9}
                    height={0.9}
                    rx={0.12}
                    fill={COLOURS[state.next]}
                  />
                ))}
              </svg>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                Lines
              </div>
              <div className="text-2xl font-bold text-ink-900" data-testid="tetris-lines">
                {state.lines}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                Level
              </div>
              <div className="text-2xl font-bold text-ink-900" data-testid="tetris-level">
                {level}
              </div>
            </div>
          </div>
        </div>

        {/* On-screen pad — the main control on a phone. Chunky targets
            with a gap, like Snake's, so a small finger doesn't catch the
            neighbour. Disabled at game over: the result panel takes over. */}
        <div className="grid w-full max-w-[300px] grid-cols-3 gap-2">
          <button
            type="button"
            aria-label="Move left"
            disabled={state.gameOver}
            onClick={() => setState(moveLeft)}
            className={PAD_BUTTON}
          >
            ◀
          </button>
          <button
            type="button"
            aria-label="Rotate"
            disabled={state.gameOver}
            onClick={() => setState(rotate)}
            className={PAD_BUTTON}
          >
            ↻
          </button>
          <button
            type="button"
            aria-label="Move right"
            disabled={state.gameOver}
            onClick={() => setState(moveRight)}
            className={PAD_BUTTON}
          >
            ▶
          </button>
          <button
            type="button"
            aria-label="Soft drop"
            disabled={state.gameOver}
            onClick={() => setState((s) => softDrop(s))}
            className={PAD_BUTTON}
          >
            ▼
          </button>
          <button
            type="button"
            aria-label="Hard drop"
            disabled={state.gameOver}
            onClick={() => setState((s) => hardDrop(s))}
            className={`${PAD_BUTTON} col-span-2 gap-2 text-base`}
          >
            <span className="text-2xl" aria-hidden>
              ⤓
            </span>
            Drop
          </button>
        </div>

        <HowToPlay
          bullets={[
            'Tap ◀ ▶ to move the piece and ↻ to turn it. On a keyboard: ← → and ↑.',
            '▼ nudges it down a row; Drop sends it straight to the floor (space bar).',
            'Fill a whole row to clear it — four rows at once scores the most.',
            'Every 10 lines the pieces fall faster. Game over when the stack reaches the top.',
          ]}
        />

        {state.gameOver ? (
          <GameOver
            tone="lose"
            title={`You scored ${state.score}`}
            detail={`${state.lines} ${state.lines === 1 ? 'line' : 'lines'} · level ${level}`}
            testId="tetris-game-over"
            onRestart={handleRestart}
            onClose={onClose}
          />
        ) : null}
      </div>
    </GameShell>
  );
}
