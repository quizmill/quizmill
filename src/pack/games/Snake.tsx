'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { GameShell } from './GameShell';
import { HowToPlay } from './HowToPlay';
import {
  newGame,
  step,
  steer,
  type Direction,
  type State,
} from '@/lib/games/snake';

interface SnakeProps {
  onClose: () => void;
}

const GRID = 16;
const TICK_MS = 180; // slightly slower than classic — friendlier for kids
const SWIPE_MIN_PX = 24;

export function Snake({ onClose }: SnakeProps) {
  const [state, setState] = useState<State>(() => newGame(GRID));
  // Refs for touch handling so listeners don't see stale state.
  const stateRef = useRef(state);
  stateRef.current = state;
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Game loop.
  useEffect(() => {
    if (state.gameOver) return;
    const id = setInterval(() => {
      setState((s) => step(s));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [state.gameOver]);

  // Keyboard controls.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const map: Record<string, Direction | undefined> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right',
      };
      const d = map[e.key];
      if (!d) return;
      e.preventDefault();
      setState((s) => steer(s, d));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Touch-swipe controls on the playfield.
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current;
    if (!start) return;
    touchStartRef.current = null;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) return;
    const d: Direction =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? 'right'
          : 'left'
        : dy > 0
          ? 'down'
          : 'up';
    setState((s) => steer(s, d));
  }

  function handleRestart() {
    setState(newGame(GRID));
  }

  const cellsBg = '#f1f5f9'; // ink-100
  const snakeFill = '#0ea5e9'; // sky-500 / brand
  const headFill = '#0369a1';
  const foodFill = '#dc2626';

  return (
    <GameShell
      title="Snake"
      emoji="🐍"
      onClose={onClose}
      status={
        <div className="flex items-center justify-between">
          <span>
            Score:{' '}
            <span className="font-semibold text-ink-900">{state.score}</span>
          </span>
          {state.gameOver ? (
            <span className="text-warn-700 font-semibold">Game over</span>
          ) : (
            <span className="text-xs text-ink-500">Swipe or arrow keys</span>
          )}
        </div>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <div
          data-testid="snake-board"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className="w-full max-w-[320px] touch-none select-none"
        >
          <svg
            viewBox={`0 0 ${GRID} ${GRID}`}
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Snake game board"
            className="block aspect-square w-full rounded-xl border border-ink-200"
            style={{ background: cellsBg }}
          >
            {/* food */}
            <circle
              cx={state.food.x + 0.5}
              cy={state.food.y + 0.5}
              r={0.32}
              fill={foodFill}
            />
            {/* snake */}
            {state.snake.map((s, i) => (
              <rect
                key={`${s.x}-${s.y}-${i}`}
                x={s.x + 0.05}
                y={s.y + 0.05}
                width={0.9}
                height={0.9}
                rx={0.15}
                fill={i === 0 ? headFill : snakeFill}
              />
            ))}
          </svg>
        </div>

        {/* On-screen direction pad — secondary to swipe, but useful on
            desktop and as a fallback if swipe-detection fails. Sized
            generously: chunky tap targets and a clear gap between
            adjacent buttons so a 9-year-old's finger doesn't catch
            the neighbour. */}
        <div className="mt-1 grid w-full max-w-[260px] grid-cols-3 gap-2 text-ink-700">
          <div />
          <button
            type="button"
            aria-label="Up"
            onClick={() => setState((s) => steer(s, 'up'))}
            className="tap-feedback flex h-16 items-center justify-center rounded-xl bg-ink-100 text-2xl font-bold hover:bg-ink-200 active:bg-ink-300"
          >
            ▲
          </button>
          <div />
          <button
            type="button"
            aria-label="Left"
            onClick={() => setState((s) => steer(s, 'left'))}
            className="tap-feedback flex h-16 items-center justify-center rounded-xl bg-ink-100 text-2xl font-bold hover:bg-ink-200 active:bg-ink-300"
          >
            ◀
          </button>
          <button
            type="button"
            aria-label="Down"
            onClick={() => setState((s) => steer(s, 'down'))}
            className="tap-feedback flex h-16 items-center justify-center rounded-xl bg-ink-100 text-2xl font-bold hover:bg-ink-200 active:bg-ink-300"
          >
            ▼
          </button>
          <button
            type="button"
            aria-label="Right"
            onClick={() => setState((s) => steer(s, 'right'))}
            className="tap-feedback flex h-16 items-center justify-center rounded-xl bg-ink-100 text-2xl font-bold hover:bg-ink-200 active:bg-ink-300"
          >
            ▶
          </button>
        </div>

        <HowToPlay
          bullets={[
            'Swipe on the board, tap the arrow buttons, or use ← ↑ → ↓ keys.',
            'Eat the red apple to grow and score a point.',
            "Don't crash into the wall or your own tail.",
            'You can\'t reverse 180° — pick a side and go around.',
          ]}
        />

        {state.gameOver ? (
          <div
            data-testid="snake-game-over"
            className="mt-1 flex flex-col items-center gap-2 rounded-xl border border-warn-500/30 bg-warn-100/60 px-3 py-3 text-center"
          >
            <div className="font-semibold text-warn-700">
              You scored {state.score}
            </div>
            <div className="flex gap-2">
              <Button size="md" variant="secondary" onClick={handleRestart}>
                Play again
              </Button>
              <Button size="md" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </GameShell>
  );
}
