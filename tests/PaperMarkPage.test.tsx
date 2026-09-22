// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    const payload = encodePaperPayload(payloadFromSheet(sheet, APP_CONFIG.packId));
    window.location.hash = `#s=${payload}`;

    await render(<PaperMarkPage />);
    expect(container.textContent).toContain('P-TEST');

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

  it('marks a sheet in batches without moving the first batch to a later day', async () => {
    const sheet = demoSheet();
    savePaperSheet(sheet);
    const [q1, q2] = packQuestions;
    const DAY1 = new Date(2026, 8, 22, 18, 0).getTime();
    const DAY2 = DAY1 + 24 * 60 * 60 * 1000;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // Day 1: only the first question done.
      vi.setSystemTime(DAY1);
      window.location.hash = `#sheet=${sheet.id}`;
      await render(<PaperMarkPage />);
      await click(q(`[aria-label="Question 1: answer ${correctKeysOf(q1)[0]}"]`));
      await click(q('[data-testid="save-marks"]'));
      expect(q('[data-testid="mark-saved"]').textContent).toContain('1/1 correct');
      expect(q('[data-testid="mark-saved"]').textContent).toMatch(/2 .*left blank/);

      // Day 2: back for the rest — the earlier answer keeps its own day.
      await act(async () => {
        root?.unmount();
      });
      vi.setSystemTime(DAY2);
      window.location.hash = `#sheet=${sheet.id}`;
      await render(<PaperMarkPage />);
      await click(q(`[aria-label="Question 2: answer ${correctKeysOf(q2)[0]}"]`));
      await click(q('[data-testid="save-marks"]'));

      const attempts = loadAttempts().sort((a, b) => a.id.localeCompare(b.id));
      expect(attempts).toHaveLength(2);
      expect(attempts[0].answeredAt).toBeGreaterThanOrEqual(DAY1);
      expect(attempts[0].answeredAt).toBeLessThan(DAY2);
      expect(attempts[1].answeredAt).toBeGreaterThanOrEqual(DAY2);
      expect(loadSessions()).toHaveLength(1);
      expect(loadSessions()[0].correctCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a sheet from a different pack', async () => {
    const payload = encodePaperPayload(
      payloadFromSheet(demoSheet(), 'some-other-pack'),
    );
    window.location.hash = `#s=${payload}`;
    await render(<PaperMarkPage />);
    expect(container.textContent).toContain('different pack');
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
    expect(q('[data-testid="paper-sheet"] svg')).toBeDefined(); // the QR
    expect(document.body.getAttribute('data-paper-print')).toBe('1');
    expect(q('[data-testid="paper-sheet"]').textContent).toContain(
      sheets[0].code,
    );
  });

  it('switches to a printable answer key for the coach', async () => {
    await render(<PaperPage />);
    await click(q('[data-testid="create-sheet"]'));
    const sheets = JSON.parse(
      localStorage.getItem(`quizmill.${APP_CONFIG.packId}.paperSheets.v1`) ?? '[]',
    );
    const first = packQuestions.find((x) => x.id === sheets[0].questionIds[0])!;
    const sheetTitle = document.title;

    // The worksheet itself carries no answers.
    expect(container.querySelector('[data-testid="key-answer"]')).toBeNull();

    await click(q('[data-testid="view-key"]'));
    const key = q('[data-testid="paper-answer-key"]');
    expect(container.querySelector('[data-testid="paper-sheet"]')).toBeNull();
    expect(key.querySelector('svg')).toBeNull(); // no QR — not for marking
    expect(key.textContent).toContain(sheets[0].code);
    const answers = Array.from(
      container.querySelectorAll('[data-testid="key-answer"]'),
    ).map((el) => el.textContent?.trim());
    expect(answers).toHaveLength(10);
    expect(answers[0]).toBe(correctKeysOf(first).join(','));
    expect(
      container.querySelectorAll('[data-testid="key-explanation"]')[0].textContent,
    ).toContain(first.explanation.slice(0, 20));
    // Still printable: the print hook stays on, and the PDF gets its own name.
    expect(document.body.getAttribute('data-paper-print')).toBe('1');
    expect(document.title).toBe(`${sheetTitle} - answer key`);

    await click(q('[data-testid="view-sheet"]'));
    expect(q('[data-testid="paper-sheet"]')).toBeDefined();
    expect(container.querySelector('[data-testid="paper-answer-key"]')).toBeNull();
    expect(document.title).toBe(sheetTitle);
  });
});
