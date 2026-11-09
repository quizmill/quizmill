// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Tetris } from '@/pack/games/Tetris';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<Tetris onClose={() => {}} />);
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
});

const score = () => Number(document.querySelector('[data-testid="tetris-score"]')!.textContent);
const isOver = () => container.querySelector('[data-testid="tetris-game-over"]') !== null;

/** Dispatch a keydown from `target`; returns whether it was cancelled. */
async function press(key: string, target: EventTarget = window): Promise<boolean> {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(e);
  });
  return e.defaultPrevented;
}

describe('Tetris keyboard', () => {
  it('hard-drops on Space from the page', async () => {
    expect(await press(' ')).toBe(true);
    expect(score()).toBeGreaterThan(0);
  });

  it('leaves Space on a focused control to the control', async () => {
    const close = container.querySelector('button[aria-label="Close game"]')!;
    expect(await press(' ', close)).toBe(false);
    expect(score()).toBe(0);
  });

  it('stops taking gameplay keys at game over', async () => {
    // Hard-drop until the stack reaches the top.
    for (let i = 0; i < 200 && !isOver(); i++) await press(' ');
    expect(isOver()).toBe(true);
    const final = score();
    expect(await press(' ')).toBe(false);
    expect(await press('ArrowDown')).toBe(false);
    expect(score()).toBe(final);
  });
});
