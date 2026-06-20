'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { shuffle } from '@/lib/selection';
import { GameShell } from './GameShell';
import { HowToPlay } from './HowToPlay';

interface MemoryProps {
  onClose: () => void;
}

interface Card {
  /** Stable identity within a game (1..PAIRS*2). */
  id: number;
  /** Display emoji — duplicated across the matching pair. */
  emoji: string;
  matched: boolean;
}

const EMOJI_POOL = ['🐠', '🦊', '🐳', '🦋', '🌸', '🍄', '🐝', '🦉', '🐢', '🌈'];
const PAIRS = 6;
const FLIP_BACK_MS = 900;

function newDeck(): Card[] {
  const picked = shuffle(EMOJI_POOL).slice(0, PAIRS);
  const deck: Card[] = [];
  picked.forEach((emoji, i) => {
    deck.push({ id: i * 2, emoji, matched: false });
    deck.push({ id: i * 2 + 1, emoji, matched: false });
  });
  return shuffle(deck);
}

export function Memory({ onClose }: MemoryProps) {
  const [deck, setDeck] = useState<Card[]>(() => newDeck());
  /** Indices of the cards currently face-up. 0, 1 or 2 entries. */
  const [openIdx, setOpenIdx] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);

  const matchedCount = useMemo(
    () => deck.filter((c) => c.matched).length,
    [deck],
  );
  const won = matchedCount === deck.length;

  // When two cards are open, evaluate after a short delay.
  useEffect(() => {
    if (openIdx.length !== 2) return;
    const [a, b] = openIdx;
    const ca = deck[a];
    const cb = deck[b];
    const match = ca.emoji === cb.emoji;
    if (match) {
      const next = deck.slice();
      next[a] = { ...ca, matched: true };
      next[b] = { ...cb, matched: true };
      setDeck(next);
      setOpenIdx([]);
      return;
    }
    const t = setTimeout(() => setOpenIdx([]), FLIP_BACK_MS);
    return () => clearTimeout(t);
  }, [openIdx, deck]);

  function handleTap(i: number) {
    if (won) return;
    if (deck[i].matched) return;
    if (openIdx.includes(i)) return;
    if (openIdx.length >= 2) return;
    const next = [...openIdx, i];
    setOpenIdx(next);
    if (next.length === 2) setMoves((m) => m + 1);
  }

  function handleRestart() {
    setDeck(newDeck());
    setOpenIdx([]);
    setMoves(0);
  }

  return (
    <GameShell
      title="Memory"
      emoji="🧠"
      onClose={onClose}
      status={
        <div className="flex items-center justify-between">
          <span>
            Pairs:{' '}
            <span className="font-semibold text-ink-900">
              {matchedCount / 2}
            </span>{' '}
            / {PAIRS}
          </span>
          <span>
            Moves:{' '}
            <span className="font-semibold text-ink-900">{moves}</span>
          </span>
        </div>
      }
    >
      <div
        data-testid="memory-board"
        className="mx-auto grid w-full max-w-[300px] grid-cols-3 gap-2"
      >
        {deck.map((card, i) => {
          const faceUp = card.matched || openIdx.includes(i);
          return (
            <button
              key={card.id}
              type="button"
              data-testid={`memory-card-${i}`}
              data-face={faceUp ? 'up' : 'down'}
              onClick={() => handleTap(i)}
              disabled={faceUp}
              className={cn(
                'tap-feedback flex aspect-square items-center justify-center rounded-xl border-2 text-3xl shadow-sm transition',
                card.matched
                  ? 'border-success-500 bg-success-100'
                  : faceUp
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-ink-200 bg-ink-100 hover:bg-ink-200',
              )}
            >
              {faceUp ? card.emoji : ''}
            </button>
          );
        })}
      </div>

      <HowToPlay
        bullets={[
          'Tap two cards to flip them face-up.',
          'A matching pair stays up; a mismatch flips back after a second.',
          'Win when all six pairs are found.',
          'Fewer moves = better memory!',
        ]}
      />

      {won ? (
        <div
          data-testid="memory-won"
          className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-success-500/40 bg-success-100/60 p-3 text-center"
        >
          <div className="text-base font-bold text-success-700">
            All pairs found! 🎉
          </div>
          <div className="text-sm text-ink-700">in {moves} moves</div>
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
