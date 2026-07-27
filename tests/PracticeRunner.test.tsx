// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackPracticeRunner } from '@/pack/PracticeRunner';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// happy-dom doesn't ship crypto.randomUUID; the runner mints session and
// attempt ids with it. Borrow Node's Web Crypto.
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}

/** A control button (Check answer / Next / See results / Another round)
 *  — Button renders without a type attribute; option buttons set
 *  type="button". */
function control(text: string): HTMLButtonElement | undefined {
  return buttons().find(
    (b) => b.type !== 'button' && (b.textContent ?? '').includes(text),
  );
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<PackPracticeRunner categoryKey="space-exploration" />);
  });
  // Let the mount → pick-session effects settle.
  await act(async () => {});
}

/** Answer every question in the round until the results screen appears. */
async function finishRound() {
  // The space-exploration bank has 5 questions; cap the loop well above
  // that so a stuck runner fails fast instead of looping forever.
  for (let i = 0; i < 20; i++) {
    if (control('Another round')) return;
    // Answer options render their key letter (A–F) first; this skips the
    // Scratchpad toggle, which also has type="button".
    const option = buttons().find(
      (b) =>
        b.type === 'button' &&
        !b.disabled &&
        /^[A-F]/.test((b.textContent ?? '').trim()),
    );
    expect(option, 'expected an answer option to be clickable').toBeTruthy();
    await click(option!);
    await click(control('Check answer')!);
    await click((control('Next question') ?? control('See results'))!);
  }
  throw new Error('round never reached the results screen');
}

describe('PackPracticeRunner', () => {
  it('starts a fresh round when "Another round" is clicked', async () => {
    await render();
    await finishRound();

    // On the results screen.
    expect(control('Another round')).toBeTruthy();

    await click(control('Another round')!);

    // Regression: the restart used to leave the runner stuck on the
    // "Loading…" placeholder because the pick-session effect never
    // re-ran. A new round must show answer options again.
    expect(container.textContent).not.toContain('Loading');
    const freshOptions = buttons().filter(
      (b) => b.type === 'button' && /^[A-F]/.test((b.textContent ?? '').trim()),
    );
    expect(freshOptions.length).toBeGreaterThan(0);
  });
});
