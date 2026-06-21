'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { GameShell } from './GameShell';
import { HowToPlay } from './HowToPlay';

interface WhackProps {
  onClose: () => void;
}

const HOLES = 9;
const GAME_SECONDS = 30;
const MOLE_LIFE_MS = 1200; // how long a mole stays up
const SPAWN_MIN_MS = 600;
const SPAWN_MAX_MS = 1100;

interface Mole {
  hole: number; // 0..8
  /** When this mole will auto-disappear. */
  diesAt: number;
}

export function Whack({ onClose }: WhackProps) {
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_SECONDS);
  const [mole, setMole] = useState<Mole | null>(null);
  /** Cells that flashed a "+1" recently — purely cosmetic. */
  const [flashes, setFlashes] = useState<Record<number, number>>({});

  const spawnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearTimers() {
    if (spawnTimerRef.current) clearTimeout(spawnTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    spawnTimerRef.current = null;
    tickRef.current = null;
  }

  function spawnMole() {
    const hole = Math.floor(Math.random() * HOLES);
    setMole({ hole, diesAt: Date.now() + MOLE_LIFE_MS });
    const next =
      SPAWN_MIN_MS + Math.random() * (SPAWN_MAX_MS - SPAWN_MIN_MS);
    spawnTimerRef.current = setTimeout(spawnMole, next);
  }

  function start() {
    setRunning(true);
    setScore(0);
    setTimeLeft(GAME_SECONDS);
    setMole(null);
    clearTimers();
    spawnMole();
    tickRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          // Round over.
          clearTimers();
          setRunning(false);
          setMole(null);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  }

  // Cull moles that have lived past their diesAt without being whacked.
  useEffect(() => {
    if (!running || !mole) return;
    const remaining = mole.diesAt - Date.now();
    if (remaining <= 0) {
      setMole(null);
      return;
    }
    const t = setTimeout(() => setMole(null), remaining);
    return () => clearTimeout(t);
  }, [mole, running]);

  // Clean up timers on unmount.
  useEffect(() => () => clearTimers(), []);

  function handleWhack(hole: number) {
    if (!running || !mole || mole.hole !== hole) return;
    setScore((s) => s + 1);
    setMole(null);
    // Flash a "+1" briefly on the whacked cell.
    setFlashes((f) => ({ ...f, [hole]: Date.now() }));
    setTimeout(() => {
      setFlashes((f) => {
        const next = { ...f };
        delete next[hole];
        return next;
      });
    }, 500);
  }

  const ended = !running && timeLeft === 0;

  return (
    <GameShell
      title="Whack-a-mole"
      emoji="🔨"
      onClose={onClose}
      status={
        <div className="flex items-center justify-between">
          <span>
            Score:{' '}
            <span className="font-semibold text-ink-900">{score}</span>
          </span>
          <span>
            Time:{' '}
            <span className="font-semibold text-ink-900">{timeLeft}s</span>
          </span>
        </div>
      }
    >
      <div
        data-testid="whack-board"
        className="mx-auto grid w-full max-w-[300px] grid-cols-3 gap-2"
      >
        {Array.from({ length: HOLES }, (_, i) => {
          const hasMole = running && mole?.hole === i;
          const flashing = flashes[i];
          return (
            <button
              key={i}
              type="button"
              data-testid={`whack-hole-${i}`}
              data-has-mole={hasMole ? 'true' : 'false'}
              onClick={() => handleWhack(i)}
              disabled={!running}
              className={cn(
                'tap-feedback relative flex aspect-square items-center justify-center rounded-2xl border-2 text-4xl shadow-sm transition',
                hasMole
                  ? 'border-warn-500 bg-warn-100'
                  : 'border-ink-200 bg-ink-100',
              )}
            >
              {hasMole ? '🐹' : ''}
              {flashing ? (
                <span className="pointer-events-none absolute -top-2 right-2 animate-bounce text-base font-bold text-success-700">
                  +1
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <HowToPlay
        bullets={[
          'Tap a mole the moment it pops out of a hole.',
          'Each whack scores a point.',
          'You have 30 seconds — go go go.',
          'Moles disappear after about a second; speed matters.',
        ]}
      />

      {!running && timeLeft === GAME_SECONDS ? (
        <div className="mt-3 flex justify-center">
          <Button size="lg" onClick={start} data-testid="whack-start">
            Start
          </Button>
        </div>
      ) : null}

      {ended ? (
        <div
          data-testid="whack-ended"
          className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-success-500/40 bg-success-100/60 p-3 text-center"
        >
          <div className="text-base font-bold text-success-700">
            Time! You whacked {score} {score === 1 ? 'mole' : 'moles'}.
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
