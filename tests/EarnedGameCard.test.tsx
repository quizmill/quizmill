// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';

// The card decides by the ACTIVE pack (games on or off, which ones), so
// the pack seam is mocked per test the way the GamesPage test does it.
const pack: { games: { include?: string[] } | undefined } = { games: {} };
vi.mock('@/pack/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pack/data')>();
  return {
    ...actual,
    get packGames() {
      return pack.games;
    },
    get gamesEnabled() {
      return pack.games !== undefined;
    },
  };
});

// `next/dynamic` needs Next's runtime; stand in with React.lazy so the
// game modal really loads (and so its code-splitting stays in place).
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    const Lazy = React.lazy(() =>
      loader().then((m) => ({
        default: (typeof m === 'function' ? m : (m as { default: unknown }).default) as React.ComponentType<Record<string, unknown>>,
      })),
    );
    return function Dynamic(props: Record<string, unknown>) {
      return (
        <React.Suspense fallback={null}>
          <Lazy {...props} />
        </React.Suspense>
      );
    };
  },
}));

// One slide from solved, so a single tap ends the puzzle — the quickest
// route to a game-over panel.
vi.mock('@/lib/games/tilePuzzle', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/games/tilePuzzle')>();
  return { ...mod, shuffle: () => [1, 2, 3, 4, 5, 6, 7, 0, 8] };
});

import { EarnedGameCard } from '@/pack/EarnedGameCard';
import { GameOver } from '@/pack/games/GameOver';
import { GameRulesContext } from '@/pack/games/GameRules';
import { earnsGame } from '@/lib/games/reward';
import { scoreTier } from '@/pack/ScoreCelebration';
import { loadEvents } from '@/lib/storage';
import { forgetSuspended, suspendGame } from '@/lib/games/suspended';
import { newGame as newTetris } from '@/lib/games/tetris';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  pack.games = {};
  forgetSuspended('tetris');
  forgetSuspended('snake');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {});
}

// Warm the module cache so the lazy chunk resolves within a tick.
await import('@/pack/games/GameModal');

/** Let a lazily loaded chunk resolve and render. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`);

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === text,
  );
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('earnsGame', () => {
  it('needs half the round right, and a round at all', () => {
    expect(earnsGame(5, 10)).toBe(true);
    expect(earnsGame(4, 10)).toBe(false);
    expect(earnsGame(10, 10)).toBe(true);
    expect(earnsGame(0, 0)).toBe(false);
  });

  it('agrees with the results screen: a game exactly when it says "Well done" or better', () => {
    for (let total = 1; total <= 12; total++) {
      for (let correct = 0; correct <= total; correct++) {
        expect(earnsGame(correct, total)).toBe(scoreTier(correct, total) !== 'steady');
      }
    }
  });
});

describe('EarnedGameCard', () => {
  it('offers one game per enabled game after a good round', async () => {
    pack.games = { include: ['tile-puzzle', 'tetris'] };
    await render(<EarnedGameCard correct={5} total={10} />);
    expect(byTestId('earned-game')).not.toBeNull();
    const buttons = Array.from(
      container.querySelectorAll('[data-testid^="earned-game-"]'),
    ).map((el) => el.getAttribute('data-testid'));
    expect(buttons).toEqual(['earned-game-tile-puzzle', 'earned-game-tetris']);
  });

  it('marks a game left paused by an earlier session as Continue', async () => {
    pack.games = { include: ['snake', 'tetris'] };
    suspendGame('tetris', newTetris());
    await render(<EarnedGameCard correct={5} total={10} />);
    expect(byTestId('earned-resume-tetris')?.textContent).toBe('Continue');
    expect(byTestId('earned-resume-snake')).toBeNull();
  });

  it('shows nothing below half right', async () => {
    await render(<EarnedGameCard correct={4} total={10} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows nothing for a pack without games, however good the round', async () => {
    pack.games = undefined;
    await render(<EarnedGameCard correct={10} total={10} />);
    expect(container.innerHTML).toBe('');
  });

  it('plays the picked game once: no Play again, no Shuffle, then the offer is spent', async () => {
    await render(<EarnedGameCard correct={8} total={10} />);
    await click(byTestId('earned-game-tile-puzzle')!);
    await settle();

    // The game opened, under one-game rules: the puzzle's mid-game
    // Shuffle is gone.
    expect(byTestId('game-shell')).not.toBeNull();
    expect(byTestId('tile-puzzle-board')).not.toBeNull();
    expect(buttonByText('Shuffle')).toBeUndefined();

    // The open was recorded as an earned game, not an arcade visit.
    const opens = loadEvents().filter((e) => e.type === 'game_open');
    expect(opens).toHaveLength(1);
    expect(opens[0].data).toEqual({ game: 'tile-puzzle', via: 'earned' });

    // The other picks are locked while it's open: no swapping in a fresh
    // game behind the modal without spending the offer.
    const snake = byTestId('earned-game-snake') as HTMLButtonElement;
    expect(snake.disabled).toBe(true);
    await click(snake);
    await settle();
    expect(byTestId('tile-puzzle-board')).not.toBeNull();
    expect(loadEvents().filter((e) => e.type === 'game_open')).toHaveLength(1);

    // One tap solves it; the result panel offers Done only.
    await click(byTestId('tile-8')!);
    expect(byTestId('tile-puzzle-solved')).not.toBeNull();
    expect(buttonByText('Play again')).toBeUndefined();
    expect(buttonByText('Done')).toBeDefined();

    await click(buttonByText('Done')!);
    expect(byTestId('game-shell')).toBeNull();
    expect(byTestId('earned-game')).toBeNull();
    expect(byTestId('earned-game-played')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="earned-game-"]')).toHaveLength(1);
  });

  it('closing the game early also spends the offer', async () => {
    await render(<EarnedGameCard correct={5} total={10} />);
    await click(byTestId('earned-game-snake')!);
    await settle();
    expect(byTestId('game-shell')).not.toBeNull();

    await click(document.querySelector('button[aria-label="Close game"]')!);
    expect(byTestId('game-shell')).toBeNull();
    expect(byTestId('earned-game-played')).not.toBeNull();
  });
});

describe('GameOver under game rules', () => {
  it('keeps Play again for free play and drops it for an earned game', async () => {
    const onRestart = vi.fn();
    await render(
      <GameOver tone="lose" title="Over" testId="x" onRestart={onRestart} onClose={() => {}} />,
    );
    expect(buttonByText('Play again')).toBeDefined();

    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    await render(
      <GameRulesContext.Provider value={{ replay: false }}>
        <GameOver tone="lose" title="Over" testId="x" onRestart={onRestart} onClose={() => {}} />
      </GameRulesContext.Provider>,
    );
    expect(buttonByText('Play again')).toBeUndefined();
    expect(buttonByText('Done')).toBeDefined();
  });
});
