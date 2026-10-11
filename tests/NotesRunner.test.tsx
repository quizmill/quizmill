// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackNotesRunner } from '@/pack/NotesRunner';
import { recordNote } from '@/lib/storage';
import { saveProgressionShown } from '@/lib/progressionPref';
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

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}

/** A control button (Check answer / Next) — Button renders without a type
 *  attribute; option buttons set type="button". */
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

/** Tap the first answer option and check it. Options render their key
 *  letter first, which skips the Scratchpad toggle (also type="button"). */
async function answerCurrent() {
  const option = buttons().find(
    (b) =>
      b.type === 'button' &&
      !b.disabled &&
      /^[A-F]/.test((b.textContent ?? '').trim()),
  );
  expect(option, 'expected an answer option to be clickable').toBeTruthy();
  await click(option!);
  await click(control('Check answer')!);
}

const xpChip = () => container.querySelector('[data-testid="xp-chip"]');

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

  // The demo pack carries a `progression` block, so a notes answer earns XP
  // like any other — and must say so, exactly as Practice and Review do.
  describe('+XP chip', () => {
    beforeEach(() => {
      recordNote('demo-planets-003', 'more greenhouse questions please', 100);
    });

    it('shows what the checked answer earned, then clears on Next', async () => {
      await render();
      expect(xpChip()).toBeNull();

      await answerCurrent();
      const chip = xpChip();
      expect(chip, 'expected the +XP chip in the feedback box').toBeTruthy();
      // A first attempt at a question always earns at least the effort
      // point, so the chip is never "+0 XP".
      const gained = Number(/\+(\d+) XP/.exec(chip!.textContent ?? '')?.[1]);
      expect(gained).toBeGreaterThan(0);

      await click(control('Next question')!);
      expect(xpChip()).toBeNull();
    });

    it('stays hidden when the device has Levels & XP switched off', async () => {
      saveProgressionShown(false);
      await render();
      await answerCurrent();
      expect(container.textContent).toMatch(/Correct\.|Not quite\./);
      expect(xpChip()).toBeNull();
    });
  });
});

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
