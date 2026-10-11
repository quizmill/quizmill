// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GameOver } from '@/pack/games/GameOver';
import { TilePuzzle } from '@/pack/games/TilePuzzle';
import { Whack } from '@/pack/games/Whack';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// One slide away from solved, so a single tap ends the puzzle.
vi.mock('@/lib/games/tilePuzzle', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/games/tilePuzzle')>();
  return { ...mod, shuffle: () => [1, 2, 3, 4, 5, 6, 7, 0, 8] };
});

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
  vi.useRealTimers();
});

async function render(el: React.ReactElement) {
  root = createRoot(container);
  await act(async () => {
    root!.render(el);
  });
}

function byTestId(id: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${id}"]`);
}

function buttonByText(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === text,
  );
  if (!b) throw new Error(`no button "${text}"`);
  return b;
}

describe('GameOver', () => {
  it('renders the testid, headline, detail and both actions', async () => {
    const onRestart = vi.fn();
    const onClose = vi.fn();
    await render(
      <GameOver
        tone="win"
        title="You win! 🏆"
        detail="5 : 2"
        testId="pong-game-over"
        onRestart={onRestart}
        onClose={onClose}
      />,
    );
    const panel = byTestId('pong-game-over');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('You win! 🏆');
    expect(panel!.textContent).toContain('5 : 2');

    await act(async () => {
      buttonByText('Play again').click();
    });
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      buttonByText('Done').click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits the detail line when none is given', async () => {
    await render(
      <GameOver
        tone="lose"
        title="You scored 3"
        testId="snake-game-over"
        onRestart={() => {}}
        onClose={() => {}}
      />,
    );
    const panel = byTestId('snake-game-over')!;
    expect(panel.textContent).toContain('You scored 3');
    expect(panel.querySelector('[data-testid="game-over-detail"]')).toBeNull();
  });

  it('tints a win green and a loss amber', async () => {
    await render(
      <GameOver
        tone="win"
        title="Solved!"
        testId="win"
        onRestart={() => {}}
        onClose={() => {}}
      />,
    );
    expect(byTestId('win')!.className).toContain('success');
    expect(byTestId('win')!.className).not.toContain('warn');

    await act(async () => {
      root!.render(
        <GameOver
          tone="lose"
          title="Game over"
          testId="lose"
          onRestart={() => {}}
          onClose={() => {}}
        />,
      );
    });
    expect(byTestId('lose')!.className).toContain('warn');
    expect(byTestId('lose')!.className).not.toContain('success');
  });
});

describe('games end on the shared panel', () => {
  it('Sliding puzzle: solving shows tile-puzzle-solved with the move count', async () => {
    await render(<TilePuzzle onClose={() => {}} />);
    expect(byTestId('tile-puzzle-solved')).toBeNull();

    await act(async () => {
      (byTestId('tile-8') as HTMLButtonElement).click();
    });
    const panel = byTestId('tile-puzzle-solved');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('Solved! ✨');
    expect(panel!.textContent).toContain('in 1 moves');
    expect(buttonByText('Play again')).toBeTruthy();
    expect(buttonByText('Done')).toBeTruthy();
  });

  it('Whack-a-mole: the 30s clock running out shows whack-ended', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await render(<Whack onClose={onClose} />);

    await act(async () => {
      (byTestId('whack-start') as HTMLButtonElement).click();
    });
    expect(byTestId('whack-ended')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    const panel = byTestId('whack-ended');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('Time! You whacked 0 moles.');

    await act(async () => {
      buttonByText('Done').click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
