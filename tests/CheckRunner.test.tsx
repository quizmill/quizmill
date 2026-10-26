// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { PackCheckRunner } from '@/pack/CheckRunner';
import { CheckResultView } from '@/pack/CheckResult';
import { CHECK_BANK, CHECK_PLAN, CHECK_RECOMMENDED_MINUTES, checkResultFor } from '@/pack/check';
import type { Attempt } from '@/data/types';
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

/** Let the (fake) clock run: the sitting's interval ticks and re-renders. */
async function elapse(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Seconds one answer takes in these tests, thinking plus reading the
 *  feedback: six of them use 540 s of the default 600 s budget, so the
 *  sixth is the last the clock allows — the planned six, as advertised. */
const THINK_MS = 60_000;
const READ_MS = 30_000;

/** Answer the current question — right, or wrong for the categories in
 *  `wrongFor` — then move on. Returns the question's category. */
async function answer(
  wrongFor: ReadonlySet<string>,
  pace: { think: number; read: number } = { think: THINK_MS, read: READ_MS },
): Promise<string> {
  const q = currentQuestion();
  const right = correctKeysOf(q);
  if (wrongFor.has(q.categoryKey)) {
    const wrong = q.options.find((o) => !right.includes(o.key))!;
    await pickOption(wrong.key);
  } else {
    for (const k of right) await pickOption(k);
  }
  await elapse(pace.think);
  await click(control('Check answer')!);
  await elapse(pace.read);
  await click((control('Next question') ?? control('See results'))!);
  return q.categoryKey;
}

async function sitCheck(wrongFor: ReadonlySet<string>) {
  for (let i = 0; i < plan.count; i++) await answer(wrongFor);
}

const plan = CHECK_PLAN!;

describe('PackCheckRunner', () => {
  it('sizes the check from the demo exam: ten minutes buy three per domain at the mock exam pace', async () => {
    await render();
    // 9-question, 15-minute mock exam over two domains: ten minutes buy
    // six at 1.67 min each — exactly the floor, so ten is recommended.
    expect(CHECK_RECOMMENDED_MINUTES).toBe(10);
    expect(plan.count).toBe(6);
    expect(plan.perDomain).toEqual([
      { key: 'planets', count: 3, share: 0.6 },
      { key: 'space-exploration', count: 3, share: 0.4 },
    ]);
    expect(plan.minutes).toBe(10);
  });

  it('explains the check before it starts, offers the budgets, and records nothing', async () => {
    await render();
    expect(text()).toContain('Could you pass Mock exam today?');
    expect(text()).toContain('A temperature check, not a mock exam');
    expect(text()).toContain('about 6 questions at the real exam');
    expect(text()).toContain('spread across all 2 domains');
    expect(text()).toContain('The clock stops the check at 10 min, never later');
    expect(text()).toContain('70%');
    // Ten, twenty or thirty minutes, each with what it buys; ten is
    // picked for the demo. There is no longer option.
    const budgets = Array.from(container.querySelectorAll('[data-testid^="check-budget-"]'));
    expect(budgets.map((b) => b.textContent)).toEqual(['10 min~6 Qs', '20 min~12 Qs', '30 min~18 Qs']);
    expect(budgets.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(byId('check-count')!.textContent).toBe('~6');
    expect(control('Start the check')).toBeTruthy();
    expect(byId('check-last')).toBeNull();
    expect(loadSessions()).toEqual([]);
  });

  it('re-sizes the check when a longer budget is picked', async () => {
    await render();
    await click(byId('check-budget-20')!);
    expect(byId('check-budget-20')!.getAttribute('aria-checked')).toBe('true');
    expect(byId('check-count')!.textContent).toBe('~12');
    expect(text()).toContain('about 12 questions at the real exam');
    expect(text()).toContain('The clock stops the check at 20 min, never later');
    await click(control('Start the check')!);
    expect(byId('check-clock')!.textContent).toBe('20:00');
    expect(byId('question-position')!.textContent).toBe('Q1');
    expect(byId('check-hint')!.textContent).toBe("about 12 at the exam's pace");
  });

  it('deals every domain its share, gives feedback per question, and ends on the result page', async () => {
    await render();
    await click(control('Start the check')!);
    const session = loadSessions()[0];
    expect(session).toMatchObject({ mode: 'check', subject: 'check', endedAt: null });
    expect(text()).toContain('Readiness check');
    expect(byId('question-position')!.textContent).toBe('Q1');
    expect(byId('check-clock')!.textContent).toBe('10:00');

    // Miss every Exploration question; feedback shows as in practice.
    const first = currentQuestion();
    const seen: string[] = [];
    seen.push(await answer(new Set(['space-exploration'])));
    expect(loadAttempts()).toHaveLength(1);
    expect(loadAttempts()[0]).toMatchObject({ mode: 'check', subject: first.categoryKey });

    for (let i = 1; i < plan.count; i++) seen.push(await answer(new Set(['space-exploration'])));
    expect(seen.filter((k) => k === 'planets')).toHaveLength(3);
    expect(seen.filter((k) => k === 'space-exploration')).toHaveLength(3);
    // Rounds: the two domains alternate, so a cut-off sitting is even.
    expect(new Set(seen.slice(0, 2)).size).toBe(2);
    expect(new Set(seen.slice(2, 4)).size).toBe(2);

    // The result page: verdict, score, study order with Exploration first.
    // No time's-up notice: the sitting ended cleanly before the bell.
    expect(byId('check-result')).toBeTruthy();
    expect(byId('check-time-up')).toBeNull();
    expect(loadSessions()[0].questionCount).toBe(6);
    expect(byId('check-score')!.textContent).toContain('3/6 correct');
    // 60% weighted estimate, but three questions per domain leave a band
    // that still reaches the 70% line — "borderline", not a confident
    // "not ready"; the page says as much.
    expect(byId('check-verdict')!.getAttribute('data-verdict')).toBe('borderline');
    expect(text()).toContain('A temperature check, not a verdict');
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

  it('deals more questions to a quicker learner, until the deck is spent', async () => {
    await render();
    await click(control('Start the check')!);
    // Ten seconds a question: six leave nine minutes, so the sitting
    // carries on past the advertised six — the hint counts what is left
    // at that pace — and only the in-scope bank (18) ends it.
    const quick = { think: 5_000, read: 5_000 };
    for (let i = 0; i < 6; i++) await answer(new Set(), quick);
    expect(byId('check-result')).toBeNull();
    expect(byId('question-position')!.textContent).toBe('Q7');
    expect(byId('check-hint')!.textContent).toBe('about 11 more at your pace');
    let dealt = 6;
    while (!byId('check-result') && dealt < 40) {
      await answer(new Set(), quick);
      dealt += 1;
    }
    expect(byId('check-result')).toBeTruthy();
    expect(byId('check-time-up')).toBeNull();
    expect(loadAttempts()).toHaveLength(CHECK_BANK.length);
    expect(loadAttempts()).toHaveLength(18);
    expect(new Set(loadAttempts().map((a) => a.questionId)).size).toBe(18);
    expect(loadSessions()[0].questionCount).toBe(18);
    expect(byId('check-score')!.textContent).toContain('18/18 correct');
  });

  it('stops dealing when the next question would not fit the time left', async () => {
    await render();
    await click(control('Start the check')!);
    // Four minutes a question: after the second, two minutes remain —
    // not enough for a third at that pace, so Next says "See results".
    const slow = { think: 200_000, read: 40_000 };
    await answer(new Set(), slow);
    // Six minutes left after the first: a second is dealt.
    expect(control('Check answer')).toBeTruthy();
    expect(byId('check-result')).toBeNull();
    const q = currentQuestion();
    for (const k of correctKeysOf(q)) await pickOption(k);
    await elapse(slow.think);
    await click(control('Check answer')!);
    await elapse(slow.read);
    expect(control('Next question')).toBeUndefined();
    await click(control('See results')!);
    expect(byId('check-result')).toBeTruthy();
    expect(byId('check-time-up')).toBeNull();
    expect(loadAttempts()).toHaveLength(2);
    expect(loadSessions()[0].questionCount).toBe(2);
    expect(loadSessions()[0].endedAt).not.toBeNull();
  });

  it('ends the sitting outright when the clock runs out, dropping the unanswered question', async () => {
    await render();
    await click(control('Start the check')!);
    await answer(new Set()); // 90 s used
    // Stuck on the second question: at ten minutes the bell goes, the
    // question on screen is dropped, and the result reads over the one
    // answer — no extra time, ever.
    await elapse(8 * 60_000);
    expect(byId('check-clock')!.textContent).toBe('0:30');
    expect(byId('check-timer')!.className).toContain('warn');
    await elapse(30_000);
    expect(byId('check-result')).toBeTruthy();
    expect(byId('check-time-up')!.textContent).toContain('The check stopped at 10 min with 1 question answered');
    expect(loadAttempts()).toHaveLength(1);
    expect(loadSessions()[0].questionCount).toBe(1);
    expect(loadSessions()[0].endedAt).not.toBeNull();
    expect(byId('check-score')!.textContent).toContain('1/1 correct');
    // Reopened from the intro, the past result shows no time's-up notice.
    await click(control('Sit it again later')!);
    await click(control('See result')!);
    expect(byId('check-time-up')).toBeNull();
  });

  it('tracks the clock, not a question total, and words the projection as a hint', async () => {
    await render();
    await click(control('Start the check')!);
    // Before the first answer: the plan's count at the exam's pace, the
    // bar empty, and no "n / m" anywhere in the sitting.
    expect(byId('question-position')!.textContent).toBe('Q1');
    expect(byId('check-hint')!.textContent).toBe("about 6 at the exam's pace");
    expect(byId('time-bar')!.getAttribute('aria-valuenow')).toBe('0');
    expect(text()).not.toMatch(/\d+\s*\/\s*\d+/);

    // Mid-sitting: 90 s a question, 450 s used after five → 150 s left,
    // one more fits; the bar is three-quarters of the clock.
    for (let i = 0; i < 4; i++) await answer(new Set());
    expect(byId('question-position')!.textContent).toBe('Q5');
    expect(byId('check-hint')!.textContent).toBe('about 1 more at your pace');
    expect(byId('time-bar')!.getAttribute('aria-valuenow')).toBe('60');
    expect(text()).not.toMatch(/\d+\s*\/\s*\d+/);

    // The last one: the sixth fits, a seventh would not.
    await answer(new Set());
    expect(byId('question-position')!.textContent).toBe('Q6');
    expect(byId('check-hint')!.textContent).toBe('last one at your pace');
    expect(text()).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it('keeps End check disabled until every domain has the plan\'s floor, with the gap in words', async () => {
    await render();
    // Twenty minutes: twelve planned, floor three a domain — six answers
    // (three each, the rounds alternate) carry a verdict.
    await click(byId('check-budget-20')!);
    await click(control('Start the check')!);
    expect(control('End check')!.disabled).toBe(true);
    expect(byId('check-end-gap')!.textContent).toBe('6 more for a verdict');
    for (let i = 0; i < 3; i++) await answer(new Set());
    expect(control('End check')!.disabled).toBe(true);
    expect(byId('check-end-gap')!.textContent).toBe('3 more for a verdict');
    // A click on the disabled action ends nothing.
    await click(control('End check')!);
    expect(byId('check-result')).toBeNull();
    for (let i = 0; i < 2; i++) await answer(new Set());
    expect(byId('check-end-gap')!.textContent).toBe('1 more for a verdict');

    // Answering the sixth opens it while its feedback shows.
    const q = currentQuestion();
    for (const k of correctKeysOf(q)) await pickOption(k);
    await elapse(THINK_MS);
    await click(control('Check answer')!);
    expect(control('End check')!.disabled).toBe(false);
    expect(byId('check-end-gap')!.textContent).toBe('Enough answered for a verdict');
  });

  it('ends early over the questions answered, exactly as the bell would', async () => {
    await render();
    await click(byId('check-budget-20')!);
    await click(control('Start the check')!);
    for (let i = 0; i < 6; i++) await answer(new Set(['space-exploration']));
    // On the seventh, unanswered: ending drops it, as time-up does.
    expect(control('End check')!.disabled).toBe(false);
    await click(control('End check')!);

    expect(byId('check-result')).toBeTruthy();
    expect(byId('check-time-up')).toBeNull();
    expect(byId('check-ended-early')!.textContent).toContain('Ended early at 6 questions');
    const session = loadSessions()[0];
    expect(session.questionCount).toBe(6);
    expect(session.correctCount).toBe(3);
    expect(session.endedAt).not.toBeNull();
    expect(loadAttempts()).toHaveLength(6);
    // The same reading time-up gives over the same six answers: nothing
    // relaxed, the band and verdict tiers as ever.
    const result = checkResultFor(loadAttempts(), session.id)!;
    expect(byId('check-score')!.textContent).toContain('3/6 correct');
    expect(byId('check-verdict')!.getAttribute('data-verdict')).toBe(result.report.verdict);
    expect(result.report.domains.every((d) => d.judged)).toBe(true);
    // Reopened from the intro, the past result shows no note.
    await click(control('Sit it again later')!);
    await click(control('See result')!);
    expect(byId('check-ended-early')).toBeNull();
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

describe('CheckResultView', () => {
  it('lists the question a solid domain still missed under that domain', async () => {
    // Five of six Planets right clears the 70% line, so Planets is not
    // in the study order — but its one miss must still be on the page.
    const planets = packQuestions.filter((q) => q.categoryKey === 'planets').slice(0, 6);
    const space = packQuestions.filter((q) => q.categoryKey === 'space-exploration').slice(0, 3);
    const at = new Date('2026-10-22T19:00:00Z').getTime();
    const attempts: Attempt[] = [...planets, ...space].map((q, i) => ({
      id: `a${i}`,
      sessionId: 'check-x',
      questionId: q.id,
      answeredAt: at + i * 1000,
      selectedAnswer: 'A',
      isCorrect: q.id !== planets[0].id,
      timeTakenSeconds: 5,
      subject: q.categoryKey,
      topic: q.id,
      difficulty: 2,
      mode: 'check',
    }));
    await act(async () => {
      root = createRoot(container);
      root.render(<CheckResultView sessionId="check-x" previous={null} attempts={attempts} />);
    });
    const row = byId('check-domain-planets')!;
    expect(row.getAttribute('data-status')).toBe('solid');
    expect(byId('check-study-planets')).toBeNull();
    expect(row.textContent).toContain('✗');
    expect(row.textContent).toContain(planets[0].prompt.replace(/[#*_`>\[\]]/g, '').slice(0, 20));
    // A domain with no misses lists nothing.
    expect(byId('check-domain-space-exploration')!.textContent).not.toContain('✗');
  });
});
