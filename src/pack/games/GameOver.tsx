'use client';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useGameRules } from './GameRules';

interface GameOverProps {
  /** Green for a win / finished round, amber for a loss. */
  tone: 'win' | 'lose';
  /** Headline — "You scored 7", "Solved! ✨", "CPU wins. Get them next time." */
  title: React.ReactNode;
  /** Optional second line — move count, final score. */
  detail?: React.ReactNode;
  /** Per-game id the E2E specs look for, e.g. `snake-game-over`. */
  testId: string;
  onRestart: () => void;
  onClose: () => void;
}

const TONE = {
  win: { box: 'border-success-500/40 bg-success-100/60', title: 'text-success-700' },
  lose: { box: 'border-warn-500/40 bg-warn-100/60', title: 'text-warn-700' },
} as const;

/**
 * The result panel every mini-game ends on: a tinted box, a headline, an
 * optional detail line and the "Play again" / "Done" pair. One component
 * so the games can't drift apart in spacing or tint again. Under
 * `replay: false` (a game earned by a practice round — one game, no
 * restarts) only "Done" is offered.
 */
export function GameOver({
  tone,
  title,
  detail,
  testId,
  onRestart,
  onClose,
}: GameOverProps) {
  const { replay } = useGameRules();
  const t = TONE[tone];
  return (
    <div
      data-testid={testId}
      className={cn(
        'mt-3 flex flex-col items-center gap-2 rounded-xl border p-3 text-center',
        t.box,
      )}
    >
      <div className={cn('text-base font-bold', t.title)}>{title}</div>
      {detail !== undefined ? (
        <div data-testid="game-over-detail" className="text-sm text-ink-700">
          {detail}
        </div>
      ) : null}
      <div className="mt-1 flex gap-2">
        {replay ? (
          <Button size="md" variant="secondary" onClick={onRestart}>
            Play again
          </Button>
        ) : null}
        <Button size="md" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
