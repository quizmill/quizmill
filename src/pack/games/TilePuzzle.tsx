'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { GameShell } from './GameShell';
import { HowToPlay } from './HowToPlay';
import { isSolved, shuffle, tapTile, type Board } from '@/lib/games/tilePuzzle';
import { cn } from '@/lib/cn';

interface TilePuzzleProps {
  onClose: () => void;
}

export function TilePuzzle({ onClose }: TilePuzzleProps) {
  const [board, setBoard] = useState<Board>(() => shuffle());
  const [moves, setMoves] = useState(0);
  const solved = isSolved(board);

  function handleTap(i: number) {
    if (solved) return;
    const next = tapTile(board, i);
    if (next === board) return; // illegal move — ignore
    setBoard(next);
    setMoves((m) => m + 1);
  }

  function handleReset() {
    setBoard(shuffle());
    setMoves(0);
  }

  const status = (
    <div className="flex items-center justify-between">
      <span>
        Moves: <span className="font-semibold text-ink-900">{moves}</span>
      </span>
      <button
        type="button"
        onClick={handleReset}
        className="text-xs font-semibold uppercase tracking-wider text-brand-700 hover:underline"
      >
        Shuffle
      </button>
    </div>
  );

  return (
    <GameShell title="Sliding puzzle" emoji="🧩" onClose={onClose} status={status}>
      <div
        data-testid="tile-puzzle-board"
        className="mx-auto grid aspect-square w-full max-w-[260px] grid-cols-3 gap-1.5 rounded-xl bg-ink-100 p-1.5"
      >
        {board.map((tile, i) => {
          if (tile === 0) {
            return (
              <div
                key={i}
                data-testid={`tile-${i}`}
                data-value="0"
                className="rounded-lg bg-ink-200/50"
              />
            );
          }
          return (
            <button
              key={i}
              type="button"
              data-testid={`tile-${i}`}
              data-value={tile}
              onClick={() => handleTap(i)}
              className={cn(
                'tap-feedback flex items-center justify-center rounded-lg text-2xl font-bold shadow-sm',
                solved
                  ? 'bg-success-100 text-success-700'
                  : 'bg-brand-500 text-white hover:bg-brand-600',
              )}
            >
              {tile}
            </button>
          );
        })}
      </div>

      <HowToPlay
        bullets={[
          'Tap a numbered tile next to the empty space to slide it in.',
          'Get the tiles back to 1–8 in order, with the empty space bottom-right.',
          'Strategy: solve the top row first, then the left column, then juggle the last four.',
          'SHUFFLE in the top-right starts you with a fresh scramble.',
        ]}
      />

      {solved ? (
        <div
          data-testid="tile-puzzle-solved"
          className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-success-500/40 bg-success-100/60 p-3 text-center"
        >
          <div className="text-base font-bold text-success-700">Solved! ✨</div>
          <div className="text-sm text-ink-700">in {moves} moves</div>
          <div className="mt-1 flex gap-2">
            <Button size="md" variant="secondary" onClick={handleReset}>
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
