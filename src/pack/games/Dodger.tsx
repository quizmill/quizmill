'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { GameShell } from './GameShell';
import { HowToPlay } from './HowToPlay';

interface DodgerProps {
  onClose: () => void;
}

/** All coords are normalised 0..1. Player is at the bottom; rocks fall. */
interface Rock {
  id: number;
  x: number;
  y: number;
  speed: number; // per second
  size: number; // 0..0.15
}

const BOARD_W = 320;
const BOARD_H = 480;
const PLAYER_W = 0.16;
const PLAYER_H = 0.04;
const PLAYER_Y = 0.92;
const TICK_MS = 30;

export function Dodger({ onClose }: DodgerProps) {
  const [playerX, setPlayerX] = useState(0.5);
  const [rocks, setRocks] = useState<Rock[]>([]);
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const startedAtRef = useRef<number>(0);
  const rockIdRef = useRef<number>(0);
  const boardRef = useRef<HTMLDivElement | null>(null);

  function start() {
    setPlayerX(0.5);
    setRocks([]);
    setScore(0);
    setRunning(true);
    setGameOver(false);
    startedAtRef.current = Date.now();
    rockIdRef.current = 0;
  }

  // Main game loop: move rocks, spawn new ones, detect collisions.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      // Difficulty ramps with time: more rocks, faster.
      const difficulty = 1 + elapsed / 18;
      setRocks((prev) => {
        // Move existing rocks down.
        const moved = prev
          .map((r) => ({ ...r, y: r.y + (r.speed * difficulty * TICK_MS) / 1000 }))
          .filter((r) => r.y < 1.1);
        // Maybe spawn one.
        if (Math.random() < 0.18 * difficulty) {
          rockIdRef.current += 1;
          moved.push({
            id: rockIdRef.current,
            x: Math.random(),
            y: -0.05,
            speed: 0.35 + Math.random() * 0.25,
            size: 0.05 + Math.random() * 0.06,
          });
        }
        return moved;
      });
      setScore(() => Math.floor(((Date.now() - startedAtRef.current) / 1000) * 10));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  // Collision detection — runs on every render of rocks/playerX in the loop.
  useEffect(() => {
    if (!running) return;
    for (const r of rocks) {
      const dx = Math.abs(r.x - playerX);
      const dy = Math.abs(r.y - PLAYER_Y);
      if (dx < PLAYER_W / 2 + r.size / 2 && dy < PLAYER_H / 2 + r.size / 2) {
        setRunning(false);
        setGameOver(true);
        return;
      }
    }
  }, [rocks, playerX, running]);

  // Touch/mouse: player follows the finger horizontally.
  function pointerToX(clientX: number): number {
    const el = boardRef.current;
    if (!el) return playerX;
    const rect = el.getBoundingClientRect();
    return Math.max(
      PLAYER_W / 2,
      Math.min(1 - PLAYER_W / 2, (clientX - rect.left) / rect.width),
    );
  }

  // Keyboard: ← → moves the player.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' || e.key === 'a') {
        setPlayerX((x) => Math.max(PLAYER_W / 2, x - 0.06));
      } else if (e.key === 'ArrowRight' || e.key === 'd') {
        setPlayerX((x) => Math.min(1 - PLAYER_W / 2, x + 0.06));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <GameShell
      title="Dodger"
      emoji="☄️"
      onClose={onClose}
      status={
        <div className="flex items-center justify-between">
          <span>
            Score:{' '}
            <span className="font-semibold text-ink-900">{score}</span>
          </span>
          <span className="text-xs text-ink-500">
            {running ? 'Move your ship!' : gameOver ? 'Hit!' : 'Tap Start'}
          </span>
        </div>
      }
    >
      <div
        ref={boardRef}
        data-testid="dodger-board"
        onTouchStart={(e) => setPlayerX(pointerToX(e.touches[0].clientX))}
        onTouchMove={(e) => {
          e.preventDefault();
          setPlayerX(pointerToX(e.touches[0].clientX));
        }}
        onMouseMove={(e) => running && setPlayerX(pointerToX(e.clientX))}
        className="relative w-full touch-none select-none overflow-hidden rounded-xl border border-ink-200 bg-gradient-to-b from-ink-900 to-ink-800"
        style={{ aspectRatio: `${BOARD_W} / ${BOARD_H}` }}
      >
        <svg
          viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Dodger board"
          className="block h-full w-full"
        >
          {/* Rocks */}
          {rocks.map((r) => (
            <circle
              key={r.id}
              cx={r.x * BOARD_W}
              cy={r.y * BOARD_H}
              r={(r.size / 2) * BOARD_W}
              fill="#a16207"
              stroke="#fde68a"
              strokeWidth="1"
            />
          ))}
          {/* Player ship */}
          {!gameOver ? (
            <polygon
              points={`
                ${playerX * BOARD_W},${(PLAYER_Y - PLAYER_H / 2) * BOARD_H}
                ${(playerX - PLAYER_W / 2) * BOARD_W},${(PLAYER_Y + PLAYER_H / 2) * BOARD_H}
                ${(playerX + PLAYER_W / 2) * BOARD_W},${(PLAYER_Y + PLAYER_H / 2) * BOARD_H}
              `}
              fill="#0ea5e9"
              stroke="white"
              strokeWidth="2"
            />
          ) : (
            // Explosion glyph on game over.
            <text
              x={playerX * BOARD_W}
              y={PLAYER_Y * BOARD_H + 10}
              fontSize="40"
              textAnchor="middle"
            >
              💥
            </text>
          )}
        </svg>
      </div>

      <HowToPlay
        bullets={[
          'Drag left and right on the board to fly your ship.',
          'Or use ← / → keys on a keyboard.',
          "Don't let the rocks touch your ship.",
          'The longer you survive, the more rocks fall — see how high you can score.',
        ]}
      />

      {!running && !gameOver ? (
        <div className="mt-3 flex justify-center">
          <Button size="lg" onClick={start} data-testid="dodger-start">
            Start
          </Button>
        </div>
      ) : null}

      {gameOver ? (
        <div
          data-testid="dodger-game-over"
          className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-warn-500/30 bg-warn-100/60 p-3 text-center"
        >
          <div className="text-base font-bold text-warn-700">
            You scored {score}
          </div>
          <div className="mt-1 flex gap-2">
            <Button size="md" variant="secondary" onClick={start}>
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
