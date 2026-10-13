// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackExamRunner } from '@/pack/ExamRunner';
import { EXAM_SITTING } from '@/pack/exam';
import { loadAttempts, loadSessions, loadAchievements } from '@/lib/storage';
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
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T20:00:00Z'));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}

/** A control button (Start / Next / Finish / Pause…) — Button renders
 *  without a type attribute; option buttons set type="button". */
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

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<PackExamRunner />);
  });
  await act(async () => {});
}

async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function text(): string {
  return container.textContent ?? '';
}

function clock(): string {
  return container.querySelector('[data-testid="exam-clock"]')?.textContent ?? '';
}

/** The question currently on screen (by its prompt). */
function currentQuestion() {
  return packQuestions.find((p) => text().includes(p.prompt))!;
}

async function pickOption(key: string) {
  const option = buttons().find(
    (b) => b.type === 'button' && !b.disabled && (b.textContent ?? '').trim().startsWith(key),
  );
  expect(option, `expected option ${key}`).toBeTruthy();
  await click(option!);
}

/** Answer the current question — right or wrong — and move on. */
async function answer(correctly: boolean) {
  const q = currentQuestion();
  const right = correctKeysOf(q);
  if (correctly) {
    for (const k of right) await pickOption(k);
  } else {
    const wrong = q.options.find((o) => !right.includes(o.key))!;
    await pickOption(wrong.key);
  }
  await click((control('Next question') ?? control('Finish exam'))!);
}

const sitting = EXAM_SITTING!;

describe('PackExamRunner', () => {
  it('explains the sitting before the clock starts', async () => {
    await render();
    expect(text()).toContain('Mock exam');
    expect(text()).toContain(`${sitting.count} questions`);
    expect(text()).toContain('13:30');
    expect(text()).toContain('70%');
    expect(control('Start exam')).toBeTruthy();
    // Nothing recorded until Start.
    expect(loadSessions()).toEqual([]);
  });

  it('runs a sitting with no feedback and grades it at the end', async () => {
    await render();
    await click(control('Start exam')!);
    expect(loadSessions()).toHaveLength(1);
    expect(loadSessions()[0]).toMatchObject({ mode: 'exam', subject: 'exam', endedAt: null });
    expect(clock()).toBe('13:30');

    // First question: wrong, on purpose — and no verdict or explanation.
    const first = currentQuestion();
    await answer(false);
    expect(text()).not.toContain('Not quite');
    expect(text()).not.toContain(first.explanation);
    expect(control('Check answer')).toBeUndefined();

    for (let i = 1; i < sitting.count; i++) await answer(true);

    expect(text()).toContain('Exam complete');
    expect(text()).toContain(`${sitting.count - 1}/${sitting.count}`);
    expect(text()).toContain('Passed');
    expect(text()).toContain('Review 1 mistake');

    const attempts = loadAttempts();
    expect(attempts).toHaveLength(sitting.count);
    expect(attempts.every((a) => a.mode === 'exam')).toBe(true);
    // Attempts keep the question's real category; only the session is 'exam'.
    expect(attempts.every((a) => a.subject !== 'exam')).toBe(true);
    const session = loadSessions()[0];
    expect(session.endedAt).not.toBeNull();
    expect(session.correctCount).toBe(sitting.count - 1);
    // The level-crossing recorder ran (progression is on for the demo).
    expect(loadAchievements().some((a) => a.id.startsWith('level-'))).toBe(true);
  });

  it('counts down, pauses with the question hidden, and resumes', async () => {
    await render();
    await click(control('Start exam')!);
    await tick(30_000);
    expect(clock()).toBe('13:00');
    expect(text()).toContain('0:30');

    const q = currentQuestion();
    await click(control('Pause')!);
    expect(text()).toContain('Paused');
    expect(text()).not.toContain(q.prompt);
    await tick(60_000);
    expect(clock()).toBe('13:00');

    await click(control('Resume')!);
    expect(text()).toContain(q.prompt);
    await tick(10_000);
    expect(clock()).toBe('12:50');
  });

  it('ends the sitting when time runs out, scoring unanswered questions as wrong', async () => {
    await render();
    await click(control('Start exam')!);
    await answer(true);
    await tick(sitting.durationSeconds * 1000 + 500);
    expect(text()).toContain("Time's up");
    expect(text()).toContain(`1/${sitting.count}`);
    expect(text()).toContain('Not passed');
    expect(loadAttempts()).toHaveLength(1);
    expect(loadSessions()[0].endedAt).not.toBeNull();
  });
});
