// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackNotesRunner } from '@/pack/NotesRunner';
import { recordNote } from '@/lib/storage';
import { correctKeysOf, packQuestions } from '@/pack/data';

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

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<PackNotesRunner />);
  });
}

describe('PackNotesRunner (against the demo pack)', () => {
  it('shows the empty state when there are no notes', async () => {
    await render();
    expect(container.textContent).toContain('No note topics yet');
  });

  it('builds a round from a noted question and its generated follow-ups', async () => {
    // demo-planets-012/013 carry generatedFrom → demo-planets-003.
    recordNote('demo-planets-003', 'more greenhouse questions please', 100);
    await render();

    // 2 follow-ups + the noted original = a 3-question round.
    expect(container.textContent).toContain('Q 1 / 3');
    expect(container.textContent).toContain('From your notes');
    // Follow-ups come first — Q1 is one of the generated questions.
    const prompt = container.textContent ?? '';
    expect(
      prompt.includes('runaway') || prompt.includes("Mercury's daytime"),
    ).toBe(true);
  });
});

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}

/** A control button — Button renders without a type attribute; option
 *  buttons set type="button". */
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

describe('PackNotesRunner results screen', () => {
  it('renders the results card exactly as before (markup pin)', async () => {
    // Deterministic score: answer the 3-question round correctly, then
    // snapshot the results card (the notes variant has three actions).
    recordNote('demo-planets-003', 'more greenhouse questions please', 100);
    await render();
    for (
      let i = 0;
      i < 10 && !container.textContent?.includes('Notes round complete');
      i++
    ) {
      const current = packQuestions.find((p) =>
        container.textContent?.includes(p.prompt),
      )!;
      for (const key of correctKeysOf(current)) {
        const option = buttons().find(
          (b) => b.type === 'button' && (b.textContent ?? '').trim().startsWith(key),
        );
        await click(option!);
      }
      await click(control('Check answer')!);
      await click((control('Next question') ?? control('See results'))!);
    }
    const card = Array.from(container.querySelectorAll('main > div')).find((d) =>
      (d.textContent ?? '').includes('Notes round complete'),
    );
    expect(card).toBeTruthy();
    await expect(card!.outerHTML).toMatchFileSnapshot(
      './__snapshots__/notes-results.html',
    );
  });
});
