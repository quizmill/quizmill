// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { CoachPage } from '@/pack/CoachPage';
import PackHome from '@/pack/Home';
import { SettingsPage } from '@/components/SettingsPage';
import { ATTEMPTS_KEY, SESSIONS_KEY, loadAttempts, loadSessions } from '@/lib/storage';
import { COACH_KEY, loadCoachModeEnabled, saveCoachModeEnabled } from '@/lib/coach';
import { packQuestions } from '@/pack/data';
import type { Attempt, Session } from '@/data/types';

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

/** Two sessions on one day plus one the day before, over the demo pack. */
function seedHistory() {
  const [q1, q2, q3] = packQuestions;
  const wrongKey = q1.options.find((o) => o.key !== q1.correctKey)!.key;
  const day = new Date(2026, 8, 21, 19, 0).getTime();
  const sessions: Session[] = [
    {
      id: 's-late',
      subject: q1.categoryKey,
      startedAt: day + 60 * 60_000,
      endedAt: day + 62 * 60_000,
      questionCount: 2,
      correctCount: 1,
      mode: 'practice',
    },
    {
      id: 's-early',
      subject: q3.categoryKey,
      startedAt: day,
      endedAt: null,
      questionCount: 10,
      correctCount: 0,
      mode: 'review',
    },
    {
      id: 's-yesterday',
      subject: q1.categoryKey,
      startedAt: day - 24 * 60 * 60_000,
      endedAt: day - 24 * 60 * 60_000 + 30_000,
      questionCount: 1,
      correctCount: 1,
    },
  ];
  const base = (over: Partial<Attempt> & Pick<Attempt, 'id' | 'sessionId' | 'questionId' | 'answeredAt'>): Attempt => ({
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 13,
    subject: q1.categoryKey,
    topic: over.questionId,
    difficulty: 2,
    ...over,
  });
  const attempts: Attempt[] = [
    base({ id: 'a1', sessionId: 's-late', questionId: q1.id, answeredAt: day + 61 * 60_000, selectedAnswer: wrongKey, isCorrect: false, position: 1, mode: 'practice' }),
    base({ id: 'a2', sessionId: 's-late', questionId: q2.id, answeredAt: day + 61 * 60_000 + 20_000, selectedAnswer: q2.correctKey!, isCorrect: true, position: 2, mode: 'practice' }),
    base({ id: 'a3', sessionId: 's-early', questionId: q3.id, answeredAt: day + 30_000, selectedAnswer: q3.correctKey!, isCorrect: true, subject: q3.categoryKey, mode: 'review' }),
    base({ id: 'a4', sessionId: 's-yesterday', questionId: q1.id, answeredAt: day - 24 * 60 * 60_000 + 10_000, selectedAnswer: q1.correctKey!, isCorrect: true }),
  ];
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
  return { q1, q2, q3, wrongKey, sessions, attempts };
}

describe('Coach mode setting', () => {
  it('defaults to off and round-trips through an app-level key', () => {
    expect(loadCoachModeEnabled()).toBe(false);
    saveCoachModeEnabled(true);
    expect(localStorage.getItem(COACH_KEY)).toBe('1');
    expect(loadCoachModeEnabled()).toBe(true);
    saveCoachModeEnabled(false);
    expect(localStorage.getItem(COACH_KEY)).toBeNull();
    expect(COACH_KEY.startsWith('quizmill.coach')).toBe(true);
  });

  it('Settings switch turns it on and shows the link', async () => {
    await render(<SettingsPage />);
    const toggle = q('[data-testid="coach-mode-toggle"]');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('[data-testid="open-coach"]')).toBeNull();
    await click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(loadCoachModeEnabled()).toBe(true);
    expect(q('[data-testid="open-coach"]').getAttribute('href')).toMatch(/^\/coach\/?$/);
  });

  it('Home shows the Coach card only when enabled', async () => {
    await render(<PackHome />);
    expect(container.querySelector('[data-testid="coach-card"]')).toBeNull();
    await act(async () => {
      root?.unmount();
    });
    saveCoachModeEnabled(true);
    await render(<PackHome />);
    expect(q('[data-testid="coach-card"]').getAttribute('href')).toMatch(/^\/coach\/?$/);
  });
});

describe('CoachPage', () => {
  it('shows an empty state with no history', async () => {
    await render(<CoachPage />);
    expect(container.querySelector('[data-testid="coach-empty"]')).not.toBeNull();
  });

  it('lists days newest first with sessions and scores, skipping empty sessions', async () => {
    seedHistory();
    await render(<CoachPage />);
    const days = container.querySelectorAll('[data-testid="coach-day"]');
    expect(days).toHaveLength(2);
    const todaySessions = days[0].querySelectorAll('[data-testid="coach-session"]');
    expect(todaySessions).toHaveLength(2);
    // newest session first within the day; its score and mode label
    expect(todaySessions[0].textContent).toContain('Practice');
    expect(todaySessions[0].textContent).toContain('1/2');
    expect(todaySessions[1].textContent).toContain('Mistakes review');
    expect(todaySessions[1].textContent).toContain('not finished');
    expect(days[0].textContent).toContain('2/3 right');
  });

  it('replays a session with answers hidden until revealed, per question and all at once', async () => {
    const { q1, wrongKey } = seedHistory();
    await render(<CoachPage />);
    await click(container.querySelectorAll('[data-testid="coach-session"]')[0]);

    expect(window.location.hash).toBe('#session=s-late');
    const steps = container.querySelectorAll('[data-testid="coach-step"]');
    expect(steps).toHaveLength(2);
    expect(steps[0].textContent).toContain(q1.prompt.slice(0, 20));
    // hidden: no answer panel, the learner's pick is not shown
    expect(container.querySelector('[data-testid="coach-answer"]')).toBeNull();
    expect(steps[0].getAttribute('data-revealed')).toBe('0');

    await click(steps[0].querySelector('[data-testid="coach-reveal"]')!);
    expect(steps[0].getAttribute('data-revealed')).toBe('1');
    const panel = q('[data-testid="coach-answer"]');
    expect(panel.textContent).toContain('Got it wrong');
    expect(panel.textContent).toContain(`answered ${wrongKey}`);
    expect(panel.textContent).toContain(`the answer is ${q1.correctKey}`);
    expect(panel.textContent).toContain(q1.explanation.slice(0, 20));
    // second still hidden
    expect(steps[1].getAttribute('data-revealed')).toBe('0');

    // toggle the first back off, then reveal all, then hide all
    await click(steps[0].querySelector('[data-testid="coach-reveal"]')!);
    expect(container.querySelector('[data-testid="coach-answer"]')).toBeNull();
    const all = q('[data-testid="coach-toggle-all"]');
    await click(all);
    expect(container.querySelectorAll('[data-testid="coach-answer"]')).toHaveLength(2);
    expect(all.textContent).toContain('Hide all');
    await click(all);
    expect(container.querySelectorAll('[data-testid="coach-answer"]')).toHaveLength(0);
  });

  it('lets you answer again together without recording anything', async () => {
    const { q1, sessions, attempts } = seedHistory();
    await render(<CoachPage />);
    await click(container.querySelectorAll('[data-testid="coach-session"]')[0]);
    const step = container.querySelectorAll('[data-testid="coach-step"]')[0];
    const option = Array.from(step.querySelectorAll('button[type="button"]')).find((b) =>
      (b.textContent ?? '').trim().startsWith(q1.correctKey!),
    )!;
    await click(option);
    expect(step.textContent).toContain(`Picked ${q1.correctKey}`);
    await click(step.querySelector('[data-testid="coach-reveal"]')!);
    expect(q('[data-testid="coach-answer"]').textContent).toContain(
      `Just now you picked ${q1.correctKey} — correct.`,
    );
    // storage untouched
    expect(loadAttempts()).toEqual(attempts);
    expect(loadSessions()).toEqual(sessions);
  });

  it('opens a session straight from the URL hash and goes back to the list', async () => {
    seedHistory();
    window.location.hash = '#session=s-early';
    await render(<CoachPage />);
    expect(container.querySelectorAll('[data-testid="coach-step"]')).toHaveLength(1);
    expect(container.textContent).toContain('Mistakes review');
    await click(q('[data-testid="coach-back"]'));
    expect(container.querySelectorAll('[data-testid="coach-day"]')).toHaveLength(2);
  });
});
