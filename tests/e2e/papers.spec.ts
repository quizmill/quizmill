import { expect, test } from '@playwright/test';
import { bodyText, clickButtonByText, pickOptionA, readStorage, waitForText } from './helpers';

/**
 * Named papers (#194), end to end against the demo pack's two starter
 * papers: the series-grouped list on Home, practising a paper whole from
 * it, and printing a whole paper from Paper practice.
 */

const ATTEMPTS_KEY = 'quizmill.solar-system-demo.attempts.v1';
const SESSIONS_KEY = 'quizmill.solar-system-demo.sessions.v1';
const tid = (id: string) => `[data-testid="${id}"]`;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto('/');
});

test('lists the papers under their series and practises one whole', async ({ page }) => {
  await waitForText(page, 'Solar System Practice');
  const list = page.locator(tid('paper-list'));
  await expect(list).toContainText('Papers');
  await expect(list).toContainText('Starter papers');
  // The one series is open by default; both rows are reachable.
  await expect(page.locator(tid('paper-row-starter-paper-1'))).toContainText('6 questions');
  await expect(page.locator(tid('paper-row-starter-paper-2'))).toContainText('5 questions');

  // Paper 2 is the five exploration questions — one round sits it whole.
  await page.click(tid('paper-row-starter-paper-2'));
  await waitForText(page, /Q\s*1\s*\/\s*5/, 20_000);
  await expect(page.locator(tid('paper-chip')).first()).toContainText('Starter papers · Paper 2');
  for (let i = 0; i < 5; i++) {
    await pickOptionA(page);
    await clickButtonByText(page, 'Check answer');
    await waitForText(page, /Correct\.|Not quite\./);
    await clickButtonByText(page, i === 4 ? 'See results' : 'Next question');
  }
  await waitForText(page, 'Practice complete');
  expect(await bodyText(page)).toContain('Paper 2');

  // Attempts carry the real category; the session is the paper's category.
  const attempts = (await readStorage<{ questionId: string; subject: string }[]>(page, ATTEMPTS_KEY)) ?? [];
  expect(attempts).toHaveLength(5);
  expect(attempts.every((a) => a.subject === 'space-exploration')).toBe(true);
  expect(attempts.every((a) => a.questionId.startsWith('demo-explore-'))).toBe(true);
  const sessions = (await readStorage<{ subject: string }[]>(page, SESSIONS_KEY)) ?? [];
  expect(sessions[0].subject).toBe('space-exploration');

  // Back on Home the paper's row reads as a sat paper.
  await page.goto('/');
  await expect(page.locator(tid('paper-row-starter-paper-2'))).toContainText('5/5 answered');
});

test('prints a whole paper from Paper practice, headed by the paper', async ({ page }) => {
  await page.goto('/paper/', { waitUntil: 'networkidle' });
  await page.selectOption(tid('paper-pick'), 'starter-paper-1');
  // A paper is the unit — the mixed-sheet controls step aside.
  await expect(page.locator('[role="radiogroup"][aria-label="Question count"]')).toHaveCount(0);
  await expect(page.locator(tid('create-sheet'))).toContainText('all 6, in order');
  await page.click(tid('create-sheet'));
  const sheet = page.locator(tid('paper-sheet'));
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Starter papers · Paper 1');
  await expect(sheet).toContainText('6 questions');
  await expect(page.locator(`${tid('paper-sheet')} [data-testid^="sheet-question-"]`)).toHaveCount(6);
  // The QR still renders for a whole paper.
  await page.locator(`${tid('paper-sheet')} svg path`).first().waitFor();
});
