'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { shuffle } from '@/lib/selection';
import { GameOver } from './GameOver';
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

  // Two open cards that don't match flip back after a short delay.
  useEffect(() => {
    if (openIdx.length !== 2) return;
    const t = setTimeout(() => setOpenIdx([]), FLIP_BACK_MS);
    return () => clearTimeout(t);
  }, [openIdx]);

  function handleTap(i: number) {
    if (won) return;
    if (deck[i].matched) return;
    if (openIdx.includes(i)) return;
    if (openIdx.length >= 2) return;
    const next = [...openIdx, i];
    if (next.length < 2) {
      setOpenIdx(next);
      return;
    }
    setMoves((m) => m + 1);
    // Second card: a pair is settled on the spot, a miss stays up to be seen.
    const [a, b] = next;
    const ca = deck[a];
    const cb = deck[b];
    if (ca.emoji !== cb.emoji) {
      setOpenIdx(next);
      return;
    }
    const matched = deck.slice();
    matched[a] = { ...ca, matched: true };
    matched[b] = { ...cb, matched: true };
    setDeck(matched);
    setOpenIdx([]);
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
                'tap-feedback flex aspect-square items-center justify-center rounded-xl border-2 text-3xl shadow-xs transition',
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
        <GameOver
          tone="win"
          title="All pairs found! 🎉"
          detail={`in ${moves} moves`}
          testId="memory-won"
          onRestart={handleRestart}
          onClose={onClose}
        />
      ) : null}
    </GameShell>
  );
}
