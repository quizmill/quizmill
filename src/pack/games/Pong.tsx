'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { GameShell } from './GameShell';
import { HowToPlay } from './HowToPlay';
import {
  newGame,
  resume,
  setPlayerY,
  step,
  BALL_RADIUS,
  PADDLE_HALF_H,
  PADDLE_X,
  WIN_SCORE,
  type PongState,
} from '@/lib/games/pong';

interface PongProps {
  onClose: () => void;
}

const TICK_MS = 30; // ~33 fps — gentle on phones, plenty smooth visually
const BOARD_W = 600;
const BOARD_H = 400;

export function Pong({ onClose }: PongProps) {
  const [state, setState] = useState<PongState>(() => newGame());
  const boardRef = useRef<HTMLDivElement | null>(null);

  // Game loop.
  useEffect(() => {
    if (state.winner) return;
    if (state.paused) return;
    const id = setInterval(() => {
      setState((s) => step(s, TICK_MS / 1000));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [state.winner, state.paused]);

  // Resume after a 1s between-point pause.
  useEffect(() => {
    if (!state.paused || state.winner) return;
    const t = setTimeout(() => setState((s) => resume(s)), 900);
    return () => clearTimeout(t);
  }, [state.paused, state.winner]);

  // Map a touch/mouse Y on the board to a normalised playerY.
  function pointerYToBoard(clientY: number): number {
    const el = boardRef.current;
    if (!el) return 0.5;
    const rect = el.getBoundingClientRect();
    return (clientY - rect.top) / rect.height;
  }

  function handlePointer(clientY: number) {
    const y = pointerYToBoard(clientY);
    setState((s) => setPlayerY(s, y));
  }

  // Keyboard for desktop.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowUp' || e.key === 'w') {
        e.preventDefault();
        setState((s) => setPlayerY(s, s.playerY - 0.06));
      } else if (e.key === 'ArrowDown' || e.key === 's') {
        e.preventDefault();
        setState((s) => setPlayerY(s, s.playerY + 0.06));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleRestart() {
    setState(newGame());
  }

  return (
    <GameShell
      title="Pong"
      emoji="🏓"
      onClose={onClose}
      status={
        <div className="flex items-center justify-between font-mono">
          <span>
            You:{' '}
            <span className="font-semibold text-brand-700">
              {state.playerScore}
            </span>
          </span>
          <span className="text-xs text-ink-500">
            First to {WIN_SCORE}
          </span>
          <span>
            CPU:{' '}
            <span className="font-semibold text-warn-700">
              {state.aiScore}
            </span>
          </span>
        </div>
      }
    >
      <div
        ref={boardRef}
        data-testid="pong-board"
        onTouchStart={(e) => handlePointer(e.touches[0].clientY)}
        onTouchMove={(e) => {
          e.preventDefault();
          handlePointer(e.touches[0].clientY);
        }}
        onMouseMove={(e) => handlePointer(e.clientY)}
        className="relative w-full touch-none select-none overflow-hidden rounded-xl border border-ink-200 bg-ink-900"
        style={{ aspectRatio: `${BOARD_W} / ${BOARD_H}` }}
      >
        <svg
          viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Pong board"
          className="block h-full w-full"
        >
          {/* Centre line */}
          <line
            x1={BOARD_W / 2}
            y1="0"
            x2={BOARD_W / 2}
            y2={BOARD_H}
            stroke="#475569"
            strokeWidth="2"
            strokeDasharray="8 8"
          />
          {/* Player paddle */}
          <rect
            x={PADDLE_X * BOARD_W - 6}
            y={(state.playerY - PADDLE_HALF_H) * BOARD_H}
            width="12"
            height={PADDLE_HALF_H * 2 * BOARD_H}
            rx="4"
            fill="#0ea5e9"
          />
          {/* AI paddle */}
          <rect
            x={(1 - PADDLE_X) * BOARD_W - 6}
            y={(state.aiY - PADDLE_HALF_H) * BOARD_H}
            width="12"
            height={PADDLE_HALF_H * 2 * BOARD_H}
            rx="4"
            fill="#dc2626"
          />
          {/* Ball */}
          <circle
            cx={state.ball.x * BOARD_W}
            cy={state.ball.y * BOARD_H}
            r={BALL_RADIUS * BOARD_W}
            fill="white"
          />
        </svg>
      </div>

      <HowToPlay
        bullets={[
          'Drag up or down on the board to move your blue paddle.',
          'Or use ↑/↓ keys on a keyboard.',
          'Bounce the ball past the red paddle to score.',
          `First to ${WIN_SCORE} wins.`,
        ]}
      />

      {state.winner ? (
        <div
          data-testid="pong-game-over"
          className={
            'mt-3 flex flex-col items-center gap-2 rounded-xl border p-3 text-center ' +
            (state.winner === 'player'
              ? 'border-success-500/40 bg-success-100/60'
              : 'border-warn-500/40 bg-warn-100/60')
          }
        >
          <div
            className={
              'text-base font-bold ' +
              (state.winner === 'player' ? 'text-success-700' : 'text-warn-700')
            }
          >
            {state.winner === 'player' ? 'You win! 🏆' : 'CPU wins. Get them next time.'}
          </div>
          <div className="text-sm text-ink-700">
            {state.playerScore} : {state.aiScore}
          </div>
          <div className="mt-1 flex gap-2">
            <Button size="md" variant="secondary" onClick={handleRestart}>
              Play again
            </Button>
            <Button size="md" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </GameShell>
  );
}
