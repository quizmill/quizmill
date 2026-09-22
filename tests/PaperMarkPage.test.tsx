// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PaperMarkPage } from '@/pack/PaperMarkPage';
import { PaperPage } from '@/pack/PaperPage';
import { loadAttempts, loadSessions } from '@/lib/storage';
import { APP_CONFIG } from '@/config';
import { packQuestions, correctKeysOf } from '@/pack/data';
import {
  encodePaperPayload,
  getPaperSheet,
  payloadFromSheet,
  savePaperSheet,
  type PaperSheet,
} from '@/pack/paper';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
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

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

function q(sel: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}

/** Poll (settling React between ticks) until `probe` returns a value.
 *  The QR payload (de)compression rides zlib, which completes on a
 *  macrotask — a plain act() flush isn't enough for the page's
 *  in-effect decode to land. */
async function waitFor<T>(probe: () => T | null | undefined | false, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = probe();
    if (found) return found;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** A three-question sheet over the demo pack's real bank. */
function demoSheet(): PaperSheet {
  const picked = packQuestions.slice(0, 3);
  return {
    id: 'sheet-under-test',
    code: 'P-TEST',
    createdAt: Date.now() - 3_600_000,
    categoryKey: picked[0].categoryKey,
    questionIds: picked.map((p) => p.id),
  };
}

describe('PaperMarkPage', () => {
  it('marks a sheet from the QR payload and writes a paper session', async () => {
    const sheet = demoSheet();
    const payload = await encodePaperPayload(
      payloadFromSheet(sheet, APP_CONFIG.packId),
    );
    window.location.hash = `#s=${payload}`;

    await render(<PaperMarkPage />);
    await waitFor(() => container.textContent?.includes('P-TEST'));

    // Q1: the correct letter; Q2: a wrong one; Q3 left blank (skipped).
    const [q1, q2] = packQuestions.slice(0, 2);
    const correct1 = correctKeysOf(q1)[0];
    const wrong2 = q2.options
      .map((o) => o.key)
      .find((k) => !correctKeysOf(q2).includes(k))!;
    await click(q(`[aria-label="Question 1: answer ${correct1}"]`));
    await click(q(`[aria-label="Question 2: answer ${wrong2}"]`));
    await click(q('[data-testid="save-marks"]'));

    // Confirmation, with the wrong answer routed to review.
    expect(q('[data-testid="mark-saved"]').textContent).toContain('1/2 correct');

    const sessions = loadSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'sheet-under-test',
      mode: 'paper',
      questionCount: 3,
      correctCount: 1,
    });

    const attempts = loadAttempts();
    expect(attempts).toHaveLength(2);
    expect(attempts.map((a) => a.id).sort()).toEqual([
      'sheet-under-test:a1',
      'sheet-under-test:a2',
    ]);
    expect(attempts.every((a) => a.mode === 'paper')).toBe(true);
    expect(attempts.every((a) => a.timeTakenSeconds === 1)).toBe(true);
  });

  it('re-marking upserts the same rows instead of duplicating them', async () => {
    const sheet = demoSheet();
    savePaperSheet(sheet);
    window.location.hash = `#sheet=${sheet.id}`;

    const [q1] = packQuestions;
    const correct1 = correctKeysOf(q1)[0];
    const wrong1 = q1.options
      .map((o) => o.key)
      .find((k) => !correctKeysOf(q1).includes(k))!;

    await render(<PaperMarkPage />);
    await click(q(`[aria-label="Question 1: answer ${wrong1}"]`));
    await click(q('[data-testid="save-marks"]'));
    expect(loadAttempts()).toHaveLength(1);
    expect(loadAttempts()[0].isCorrect).toBe(false);
    expect(getPaperSheet(sheet.id)?.markedAt).toBeDefined();

    // Re-open: pre-filled from the earlier marking, then corrected.
    await act(async () => {
      root?.unmount();
    });
    window.location.hash = `#sheet=${sheet.id}`;
    await render(<PaperMarkPage />);
    expect(container.textContent).toContain('Marked before');
    const prefilled = q(`[aria-label="Question 1: answer ${wrong1}"]`);
    expect(prefilled.getAttribute('aria-pressed')).toBe('true');

    await click(q(`[aria-label="Question 1: answer ${correct1}"]`));
    await click(q('[data-testid="save-marks"]'));

    const attempts = loadAttempts();
    expect(attempts).toHaveLength(1); // upserted, not appended
    expect(attempts[0].isCorrect).toBe(true);
    expect(attempts[0].selectedAnswer).toBe(correct1);
    expect(loadSessions()).toHaveLength(1);
  });

  it('refuses a sheet from a different pack', async () => {
    const payload = await encodePaperPayload(
      payloadFromSheet(demoSheet(), 'some-other-pack'),
    );
    window.location.hash = `#s=${payload}`;
    await render(<PaperMarkPage />);
    await waitFor(() => container.textContent?.includes('different pack'));
    expect(container.querySelector('[data-testid="save-marks"]')).toBeNull();
  });

  it('explains an unreadable link', async () => {
    window.location.hash = '#s=@@@not-a-payload@@@';
    await render(<PaperMarkPage />);
    expect(container.textContent).toContain("couldn't be read");
  });
});

describe('PaperPage', () => {
  it('composes a sheet, stores it, and shows the printable layout', async () => {
    await render(<PaperPage />);
    await click(q('[data-testid="create-sheet"]'));

    const sheets = JSON.parse(
      localStorage.getItem(`quizmill.${APP_CONFIG.packId}.paperSheets.v1`) ?? '[]',
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0].questionIds).toHaveLength(10);

    // The hash navigation lands on the sheet view with the print layout.
    expect(window.location.hash).toContain('#sheet=');
    expect(q('[data-testid="paper-sheet"]')).toBeDefined();
    // The QR appears once the async payload encode lands.
    const qrSvg = await waitFor(() =>
      container.querySelector<HTMLElement>('[data-testid="paper-sheet"] svg'),
    );
    // Spec quiet zone: the first dark module (finder corner) sits 4
    // modules in, and the viewBox is 8 modules wider than the symbol.
    expect(qrSvg.querySelector('path')?.getAttribute('d')).toMatch(/^M4 4h1/);
    const [, , vbSize] = (qrSvg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(vbSize).toBeGreaterThan(8);
    expect(document.body.getAttribute('data-paper-print')).toBe('1');
    expect(q('[data-testid="paper-sheet"]').textContent).toContain(
      sheets[0].code,
    );
  });
});
