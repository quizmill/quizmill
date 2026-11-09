// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GameModal } from '@/pack/games/GameModal';
import { GAME_SESSION_MS, type GameId } from '@/lib/games/registry';
import { forgetSuspended, hasSuspended, suspendGame } from '@/lib/games/suspended';
import { newGame } from '@/lib/games/tetris';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  forgetSuspended('tetris');
  forgetSuspended('snake');
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await unmount();
  container.remove();
  vi.useRealTimers();
});

async function open(game: GameId, opts: { replay?: boolean; onClose?: () => void } = {}) {
  await act(async () => {
    root = createRoot(container);
    root.render(<GameModal game={game} replay={opts.replay} onClose={opts.onClose ?? (() => {})} />);
  });
}

async function unmount() {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function press(key: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const button = (text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
const tetrisScore = () => Number(byTestId('tetris-score')!.textContent);

describe('game session cap', () => {
  it("ends any game after ten minutes, even in free play: Time's up, Done only", async () => {
    const onClose = vi.fn();
    await open('tile-puzzle', { replay: true, onClose });
    await advance(GAME_SESSION_MS - 1);
    expect(byTestId('tile-puzzle-board')).not.toBeNull();

    await advance(1);
    expect(byTestId('tile-puzzle-board')).toBeNull();
    expect(byTestId('game-time-up')).not.toBeNull();
    expect(byTestId('game-over-detail')!.textContent).toContain('10 minutes');
    expect(button('Play again')).toBeUndefined();

    await act(async () => {
      button('Done')!.click();
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('resumable games', () => {
  it('pauses an unfinished Tetris at the cap and carries on next session, held until the first move', async () => {
    await open('tetris', { replay: false });
    await press(' ');
    const score = tetrisScore();
    expect(score).toBeGreaterThan(0);

    await advance(GAME_SESSION_MS);
    expect(byTestId('game-time-up')).not.toBeNull();
    expect(byTestId('game-over-detail')!.textContent).toContain('paused');
    expect(hasSuspended('tetris')).toBe(true);
    await unmount();

    // Next session: same game, waiting for the player.
    await open('tetris', { replay: false });
    expect(tetrisScore()).toBe(score);
    expect(byTestId('game-held')).not.toBeNull();
    const board = byTestId('tetris-board')!.innerHTML;
    await advance(5000);
    expect(byTestId('tetris-board')!.innerHTML).toBe(board);
    expect(hasSuspended('tetris')).toBe(false);

    // The first move releases it; gravity runs again.
    await press('ArrowLeft');
    expect(byTestId('game-held')).toBeNull();
    const moved = byTestId('tetris-board')!.innerHTML;
    await advance(2000);
    expect(byTestId('tetris-board')!.innerHTML).not.toBe(moved);
  });

  it('also pauses a Snake closed mid-game', async () => {
    await open('snake');
    await unmount();
    expect(hasSuspended('snake')).toBe(true);
  });

  it('a finished game leaves nothing to resume', async () => {
    await open('tetris');
    for (let i = 0; i < 200 && !byTestId('tetris-game-over'); i++) await press(' ');
    expect(byTestId('tetris-game-over')).not.toBeNull();
    await unmount();
    expect(hasSuspended('tetris')).toBe(false);
  });

  it("other games just end at the cap: nothing to resume", async () => {
    await open('tile-puzzle');
    await advance(GAME_SESSION_MS);
    expect(byTestId('game-over-detail')!.textContent).toContain('10 minutes');
  });

  it('a paused game is the one that opens, whatever started it', async () => {
    const saved = { ...newGame(), score: 1234 };
    suspendGame('tetris', saved);
    await open('tetris');
    expect(tetrisScore()).toBe(1234);
  });
});
