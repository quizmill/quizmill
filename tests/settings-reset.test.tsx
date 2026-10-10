// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { SettingsPage } from '@/components/SettingsPage';
import { loadAttempts, loadSessions, saveAttempt, saveSession } from '@/lib/storage';
import type { Attempt, Session } from '@/data/types';

// React needs this flag to allow act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

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
  vi.restoreAllMocks();
});

async function render(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  await act(async () => {});
}

function button(text: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
  if (!el) throw new Error(`no button containing "${text}"`);
  return el;
}

function seed(answeredAt: number) {
  const session: Session = {
    id: `s-${answeredAt}`,
    subject: 'planets',
    startedAt: answeredAt,
    endedAt: answeredAt + 1000,
    questionCount: 1,
    correctCount: 1,
  };
  const attempt: Attempt = {
    id: `a-${answeredAt}`,
    sessionId: session.id,
    questionId: 'q1',
    answeredAt,
    selectedAnswer: 'A',
    isCorrect: true,
    timeTakenSeconds: 3,
    subject: 'planets',
    topic: 'q1',
    difficulty: 1,
  };
  saveSession(session);
  saveAttempt(attempt);
}

describe('Settings reset buttons', () => {
  it('are disabled with nothing to reset', async () => {
    await render(<SettingsPage />);
    expect(button('Reset today').disabled).toBe(true);
    expect(button('Reset everything').disabled).toBe(true);
  });

  it('enables only Reset everything when the practice is three days old', async () => {
    seed(Date.now() - 3 * 24 * 60 * 60_000);
    await render(<SettingsPage />);
    expect(button('Reset today').disabled).toBe(true);
    expect(button('Reset everything').disabled).toBe(false);
  });

  it('clears everything after confirming, and reports it', async () => {
    // Seed at "now": a minute ago would fall on yesterday right after midnight.
    seed(Date.now());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render(<SettingsPage />);
    expect(button('Reset today').disabled).toBe(false);
    await act(async () => {
      button('Reset everything').click();
    });
    expect(loadSessions()).toHaveLength(0);
    expect(loadAttempts()).toHaveLength(0);
    expect(container.textContent).toContain('All local progress erased.');
    expect(button('Reset everything').disabled).toBe(true);
  });

  it('does nothing when the confirm is dismissed', async () => {
    seed(Date.now());
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await render(<SettingsPage />);
    await act(async () => {
      button('Reset today').click();
    });
    expect(loadAttempts()).toHaveLength(1);
    expect(button('Reset today').disabled).toBe(false);
  });
});
