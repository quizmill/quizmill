// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackCheckRunner } from '@/pack/CheckRunner';
import { CHECK_PLAN } from '@/pack/check';
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
  vi.setSystemTime(new Date('2026-10-22T20:00:00Z'));
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

/** A control button (Start / Check answer / Next…) — Button renders
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
    root.render(<PackCheckRunner />);
  });
  await act(async () => {});
}

function text(): string {
  return container.textContent ?? '';
}

function byId(id: string): Element | null {
  return container.querySelector(`[data-testid="${id}"]`);
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

/** Answer the current question — right, or wrong for the categories in
 *  `wrongFor` — then move on. Returns the question's category. */
async function answer(wrongFor: ReadonlySet<string>): Promise<string> {
  const q = currentQuestion();
  const right = correctKeysOf(q);
  if (wrongFor.has(q.categoryKey)) {
    const wrong = q.options.find((o) => !right.includes(o.key))!;
    await pickOption(wrong.key);
  } else {
    for (const k of right) await pickOption(k);
  }
  await click(control('Check answer')!);
  await click((control('Next question') ?? control('See results'))!);
  return q.categoryKey;
}

async function sitCheck(wrongFor: ReadonlySet<string>) {
  for (let i = 0; i < plan.count; i++) await answer(wrongFor);
}

const plan = CHECK_PLAN!;

describe('PackCheckRunner', () => {
  it('sizes the check from the demo exam: three per domain, at the mock exam pace', async () => {
    await render();
    // 9-question, 15-minute mock exam over two domains: the floor wins.
    expect(plan.count).toBe(6);
    expect(plan.perDomain).toEqual([
      { key: 'planets', count: 3 },
      { key: 'space-exploration', count: 3 },
    ]);
    expect(plan.minutes).toBe(10);
  });

  it('explains the check before it starts, and records nothing', async () => {
    await render();
    expect(text()).toContain('Could you pass Mock exam today?');
    expect(text()).toContain('6 questions spread across all 2 domains');
    expect(text()).toContain('about 10 min');
    expect(text()).toContain('70%');
    expect(control('Start the check')).toBeTruthy();
    expect(byId('check-last')).toBeNull();
    expect(loadSessions()).toEqual([]);
  });

  it('deals every domain its share, gives feedback per question, and ends on the result page', async () => {
    await render();
    await click(control('Start the check')!);
    const session = loadSessions()[0];
    expect(session).toMatchObject({ mode: 'check', subject: 'check', endedAt: null });
    expect(text()).toContain('Readiness check');
    expect(text()).toMatch(/Q\s*1\s*\/\s*6/);

    // Miss every Exploration question; feedback shows as in practice.
    const first = currentQuestion();
    const seen: string[] = [];
    seen.push(await answer(new Set(['space-exploration'])));
    expect(loadAttempts()).toHaveLength(1);
    expect(loadAttempts()[0]).toMatchObject({ mode: 'check', subject: first.categoryKey });

    for (let i = 1; i < plan.count; i++) seen.push(await answer(new Set(['space-exploration'])));
    expect(seen.filter((k) => k === 'planets')).toHaveLength(3);
    expect(seen.filter((k) => k === 'space-exploration')).toHaveLength(3);

    // The result page: verdict, score, study order with Exploration first.
    expect(byId('check-result')).toBeTruthy();
    expect(byId('check-score')!.textContent).toContain('3/6 correct');
    // 60% weighted estimate, but three questions per domain leave a band
    // that still reaches the 70% line — "borderline", not a confident
    // "not ready"; the page says as much.
    expect(byId('check-verdict')!.getAttribute('data-verdict')).toBe('borderline');
    expect(text()).toContain('A quick read, not a verdict');
    expect(byId('check-domain-planets')!.getAttribute('data-status')).toBe('solid');
    expect(byId('check-domain-space-exploration')!.getAttribute('data-status')).toBe('weak');
    const study = byId('check-study-space-exploration')!;
    // (next/link renders the trailing-slash form without the slash.)
    expect(study.getAttribute('href')).toBe('/practice?subject=space-exploration');
    expect(study.textContent).toContain('0% here');
    expect(study.textContent).toContain('70 points below the pass line');
    expect(study.textContent).toContain('40% of the exam');
    expect(byId('check-study-planets')).toBeNull();
    // The missed questions are listed under the domain.
    const missed = loadAttempts().filter((a) => !a.isCorrect).map((a) => a.questionId);
    expect(missed).toHaveLength(3);
    expect(byId('check-comparison')).toBeNull();
    expect(control('Review 3 mistakes from this check')).toBeTruthy();

    // Every answer is a distinct question (a cold look), the session
    // closed, and the level-crossing recorder ran (progression is on).
    const attempts = loadAttempts();
    expect(new Set(attempts.map((a) => a.questionId)).size).toBe(plan.count);
    expect(attempts.every((a) => a.mode === 'check' && a.subject !== 'check')).toBe(true);
    expect(loadSessions()[0].endedAt).not.toBeNull();
    expect(loadSessions()[0].correctCount).toBe(3);
    expect(loadAchievements().some((a) => a.id.startsWith('level-'))).toBe(true);
  });

  it('shows the feedback panel with the explanation after Check answer', async () => {
    await render();
    await click(control('Start the check')!);
    const q = currentQuestion();
    const right = correctKeysOf(q);
    const wrong = q.options.find((o) => !right.includes(o.key))!;
    await pickOption(wrong.key);
    await click(control('Check answer')!);
    expect(text()).toContain('Not quite.');
    // The explanation is markdown; compare its opening words flattened.
    const flat = (s: string) => s.replace(/[#*_`>\[\]]/g, '').replace(/\s+/g, ' ');
    expect(flat(text())).toContain(flat(q.explanation).slice(0, 24));
    expect(control('Next question')).toBeTruthy();
  });

  it('keeps the previous result and compares the next sitting against it', async () => {
    await render();
    await click(control('Start the check')!);
    await sitCheck(new Set(['space-exploration', 'planets']));
    expect(byId('check-score')!.textContent).toContain('0/6 correct');

    // Back on the intro, the last check is summarised and can be reopened.
    await click(control('Sit it again later')!);
    expect(byId('check-last')).toBeTruthy();
    expect(byId('check-last')!.textContent).toContain('0/6 correct');
    expect(control('Sit it again')).toBeTruthy();
    await click(control('See result')!);
    expect(byId('check-score')!.textContent).toContain('0/6 correct');
    expect(byId('check-comparison')).toBeNull();
    await click(control('Sit it again later')!);

    // A second sitting, all right — seen questions are dealt again only
    // once a domain's unseen run out: Exploration holds five, so two of
    // its three are new and one repeats; Planets has plenty.
    vi.setSystemTime(new Date('2026-10-23T20:00:00Z'));
    await click(control('Sit it again')!);
    await sitCheck(new Set());
    expect(byId('check-score')!.textContent).toContain('6/6 correct');
    expect(byId('check-comparison')!.textContent).toContain('Last check: 0% →');
    expect(byId('check-comparison')!.textContent).toContain('100%');
    expect(byId('check-comparison')!.textContent).toContain('(+100)');
    expect(byId('check-domain-planets')!.textContent).toContain('(+100)');
    expect(byId('check-verdict')!.getAttribute('data-verdict')).not.toBe('not-ready');

    const ids = loadAttempts().map((a) => a.questionId);
    expect(new Set(ids).size).toBe(11);
    expect(loadSessions().filter((s) => s.mode === 'check' && s.endedAt !== null)).toHaveLength(2);
  });
});
