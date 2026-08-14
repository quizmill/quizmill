// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackNotesRunner } from '@/pack/NotesRunner';
import { recordNote } from '@/lib/storage';

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
