// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ProgressPage from '@/pack/ProgressPage';
import { ATTEMPTS_KEY, SESSIONS_KEY } from '@/lib/storage';
import { saveProgressionShown } from '@/lib/progressionPref';
import { packQuestions } from '@/pack/data';
import type { Attempt, Session } from '@/data/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  localStorage.clear();
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

/** One completed session of the given length (seconds), one attempt in it. */
function seedSession(durationSeconds: number) {
  const q1 = packQuestions[0];
  const startedAt = new Date(2026, 8, 21, 19, 0).getTime();
  const sessions: Session[] = [
    {
      id: 's1',
      subject: q1.categoryKey,
      startedAt,
      endedAt: startedAt + durationSeconds * 1000,
      questionCount: 1,
      correctCount: 1,
      mode: 'practice',
    },
  ];
  const attempts: Attempt[] = [
    {
      id: 'a1',
      sessionId: 's1',
      questionId: q1.id,
      answeredAt: startedAt + 10_000,
      selectedAnswer: q1.correctKey!,
      isCorrect: true,
      timeTakenSeconds: 10,
      subject: q1.categoryKey,
      topic: q1.id,
      difficulty: 2,
    },
  ];
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
}

function summaryText(): string {
  const el = container.querySelector('[data-testid="session-summary"]');
  if (!el) throw new Error('missing session summary');
  return el.textContent ?? '';
}

describe('ProgressPage session summary', () => {
  it('spells the typical session length the way Coach does (rounded minutes)', async () => {
    seedSession(270); // 4m 30s → rounds to 5 min, never "4m 30s"
    await render(<ProgressPage />);
    expect(summaryText()).toContain('5 mintypical length');
    expect(summaryText()).not.toContain('4m');
  });

  it('keeps seconds for sub-minute sessions and shows hours for long ones', async () => {
    seedSession(45);
    await render(<ProgressPage />);
    expect(summaryText()).toContain('45 stypical length');

    await act(async () => {
      root?.unmount();
    });
    root = undefined;

    seedSession(3900);
    await render(<ProgressPage />);
    expect(summaryText()).toContain('1 h 05 mintypical length');
  });
});

// ——— The level / streak / totals card (moved here from Home, #188) ———

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

const DAY = 24 * 3600_000;

/** N distinct-question correct attempts, `offset` days ago. */
function fullDay(offset: number, n = 10): Attempt[] {
  return Array.from({ length: n }, (_, i) => ({
    ...attempt(`demo-planets-${offset}-${i}`, 'planets', true),
    id: `d${offset}-a${i}`,
    answeredAt: Date.now() - offset * DAY,
  }));
}

describe('ProgressPage level card (progression)', () => {
  it('shows Level 1 · Grain before any practice, above the empty state', async () => {
    await render(<ProgressPage />);
    const card = container.querySelector('[data-testid="level-card"]');
    expect(card).toBeTruthy();
    expect(card!.textContent).toContain('Level 1 · Grain');
    expect(container.textContent).toContain('No practice yet');
  });

  it('derives the level and XP retroactively from history', async () => {
    // 10 first-time-correct answers today: 10×(1+10) + 25 daily = 135 XP.
    // Demo ladder (18-question bank → the 1000 XP floor): level 3 at 80,
    // level 4 at 150.
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(fullDay(0)));
    await render(<ProgressPage />);
    const card = container.querySelector('[data-testid="level-card"]');
    expect(card!.textContent).toContain('Level 3 · Mill Hand');
    expect(card!.textContent).toContain('135 XP');
    expect(card!.textContent).toContain('15 XP to Apprentice Miller');
  });

  it('is hidden when the device pref turns Levels & XP off', async () => {
    saveProgressionShown(false);
    await render(<ProgressPage />);
    expect(container.querySelector('[data-testid="level-card"]')).toBeNull();
  });
});

describe('ProgressPage navigation', () => {
  it('keeps its "← Home" link — the way back on desktop, where there is no tab bar', async () => {
    await render(<ProgressPage />);
    const back = container.querySelector('header a[href="/"]');
    expect(back).toBeTruthy();
    expect(back!.textContent).toContain('Home');
  });
});

describe('ProgressPage streak and totals', () => {
  it('shows the live streak and the day’s goal', async () => {
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify([...fullDay(0), ...fullDay(1)]));
    await render(<ProgressPage />);
    const streak = container.querySelector('[data-testid="streak-card"]');
    expect(streak!.textContent).toContain('2-day streak');
    expect(streak!.textContent).toContain('10/10');
  });

  it('shows the best-ever record when the live streak has lapsed', async () => {
    // A 3-day run three weeks ago, nothing since: current streak 0, but
    // the record survives — that is the anti-loss-aversion point.
    localStorage.setItem(
      ATTEMPTS_KEY,
      JSON.stringify([...fullDay(20), ...fullDay(21), ...fullDay(22)]),
    );
    await render(<ProgressPage />);
    const best = container.querySelector('[data-testid="best-streak"]');
    expect(best).toBeTruthy();
    expect(best!.textContent).toContain('Best: 3 days');
  });

  it('folds answered-of-bank and accuracy into one line, counting a re-answered question once', async () => {
    // Wrong then rescued: one distinct question, latest look correct.
    localStorage.setItem(
      ATTEMPTS_KEY,
      JSON.stringify([
        { ...attempt('demo-planets-001', 'planets', false), id: 'a1', sessionId: 's1', answeredAt: 1000 },
        { ...attempt('demo-planets-001', 'planets', true), id: 'a2', sessionId: 's2', answeredAt: 2000 },
        { ...attempt('demo-planets-002', 'planets', false), id: 'a3', sessionId: 's2', answeredAt: 3000 },
      ]),
    );
    await render(<ProgressPage />);
    const line = container.querySelector('[data-testid="totals-line"]');
    expect(line!.textContent).toContain(`2 of ${packQuestions.length} questions answered`);
    expect(line!.textContent).toContain('50% accuracy');
  });
});
