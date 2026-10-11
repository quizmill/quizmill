// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ProgressPage from '@/pack/ProgressPage';
import { ATTEMPTS_KEY, SESSIONS_KEY } from '@/lib/storage';
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
