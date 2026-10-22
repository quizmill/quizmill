// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PackHome from '@/pack/Home';
import ExamReadiness from '@/pack/ExamReadiness';
import { SESSIONS_KEY, loadPrefs } from '@/lib/storage';
import type { Attempt, Session } from '@/data/types';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {});
}

function attempt(questionId: string, subject: string, isCorrect: boolean): Attempt {
  return {
    id: `attempt-${questionId}`,
    sessionId: 'session-1',
    questionId,
    answeredAt: Date.now(),
    selectedAnswer: 'A',
    isCorrect,
    timeTakenSeconds: 5,
    subject,
    topic: questionId,
    difficulty: 1,
  };
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function byId(id: string): Element | null {
  return container.querySelector(`[data-testid="${id}"]`);
}

describe('PackHome readiness-check prompt', () => {
  it('asks "could you pass today?" above the practice loop, with a tap into the check', async () => {
    await render(<PackHome />);
    const card = byId('check-prompt')!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Could you pass Mock exam today?');
    expect(card.textContent).toContain('A temperature check: 10 to 30 minutes across every domain');
    expect(byId('check-prompt-start')!.getAttribute('href')).toBe('/practice/check');
    // Above the categories and the rail — the first thing an exam pack says.
    const order = Array.from(container.querySelectorAll('[data-testid]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(order.indexOf('check-prompt')).toBeLessThan(order.indexOf('mode-rail'));
  });

  it('goes away for good on "Not interested", and the tile stays', async () => {
    await render(<PackHome />);
    await click(byId('check-prompt-dismiss')!);
    expect(byId('check-prompt')).toBeNull();
    expect(byId('check-card')).toBeTruthy();
    expect(loadPrefs().checkPromptDismissed).toBe(true);
    // Remembered for this pack on this device: a fresh render stays quiet.
    await act(async () => {
      root.unmount();
    });
    await render(<PackHome />);
    expect(byId('check-prompt')).toBeNull();
    expect(byId('check-card')).toBeTruthy();
  });

  it('retires once a check has been sat', async () => {
    const sat: Session = {
      id: 'check-1',
      subject: 'check',
      startedAt: Date.now() - 3600_000,
      endedAt: Date.now() - 3000_000,
      questionCount: 6,
      correctCount: 4,
      mode: 'check',
    };
    localStorage.setItem(SESSIONS_KEY, JSON.stringify([sat]));
    await render(<PackHome />);
    expect(byId('check-prompt')).toBeNull();
    expect(byId('check-card')).toBeTruthy();
  });

  it('ignores an abandoned sitting', async () => {
    const abandoned: Session = {
      id: 'check-0',
      subject: 'check',
      startedAt: Date.now() - 3600_000,
      endedAt: null,
      questionCount: 6,
      correctCount: 0,
      mode: 'check',
    };
    localStorage.setItem(SESSIONS_KEY, JSON.stringify([abandoned]));
    await render(<PackHome />);
    expect(byId('check-prompt')).toBeTruthy();
  });
});

describe('PackHome readiness-check tile', () => {
  it('offers the check next to the timed exam, with the budgets it can take', async () => {
    await render(<PackHome />);
    const card = container.querySelector('[data-testid="check-card"]');
    expect(card).toBeTruthy();
    expect(card!.getAttribute('href')).toBe('/practice/check');
    // A one-word label: five tiles in the rail leave no room for "Readiness".
    expect(card!.textContent).toContain('Check');
    // The learner picks ten, twenty or thirty minutes on the next screen.
    expect(card!.textContent).toContain('10–30 min');
    // Last in the rail, after the exam tile.
    const tiles = Array.from(container.querySelectorAll('[data-testid="mode-rail"] a')).map((a) =>
      a.getAttribute('data-testid'),
    );
    expect(tiles.indexOf('check-card')).toBe(tiles.length - 1);
    expect(tiles.indexOf('exam-card')).toBe(tiles.length - 2);
  });
});

describe('ExamReadiness → readiness check', () => {
  it('links to the check while the blueprint is not yet covered', async () => {
    await render(<ExamReadiness attempts={[attempt('demo-planets-001', 'planets', true)]} />);
    const link = container.querySelector('[data-testid="readiness-check-link"]');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/practice/check');
    expect(link!.textContent).toContain('10 to 30 minutes across every domain, your choice of length');
    expect(link!.textContent).toContain('a temperature check');
  });

  it('drops the link once enough history gives a real verdict', async () => {
    // Twelve first attempts in the 60%-weight domain clear the judged gate.
    const attempts = Array.from({ length: 12 }, (_, i) =>
      attempt(`demo-planets-${i}`, 'planets', true),
    );
    await render(<ExamReadiness attempts={attempts} />);
    const verdict = container.querySelector('[data-testid="readiness-verdict"]');
    expect(verdict!.getAttribute('data-verdict')).not.toBe('no-data');
    expect(container.querySelector('[data-testid="readiness-check-link"]')).toBeNull();
  });
});
