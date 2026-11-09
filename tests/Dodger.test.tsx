// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dodger } from '@/pack/games/Dodger';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(async () => {
  vi.useFakeTimers();
  // Every tick spawns a rock at x = 0.1 — steer under it to get hit.
  vi.spyOn(Math, 'random').mockReturnValue(0.1);
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<Dodger onClose={() => {}} />);
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);

async function press(key: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
}

describe('Dodger game over', () => {
  it('holds after a hit: the ship cannot be steered off the rock to resume', async () => {
    await act(async () => {
      (byTestId('dodger-start') as HTMLButtonElement).click();
    });
    for (let i = 0; i < 8; i++) await press('ArrowLeft');
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(byTestId('dodger-game-over')).not.toBeNull();

    for (let i = 0; i < 10; i++) await press('ArrowRight');
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(byTestId('dodger-game-over')).not.toBeNull();
  });
});
