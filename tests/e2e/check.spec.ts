import { expect, test } from '@playwright/test';
import { bodyText, clickButtonByText, pickOptionA, readStorage, waitForText } from './helpers';

/**
 * The readiness check against the demo pack: its mock exam spans two
 * weighted domains, so a ten-minute check advertises three questions
 * from each — six — with feedback after every answer, then the result
 * page. The sitting is time-boxed, not counted: a tester answering in
 * seconds is dealt more, up to the whole in-scope bank (18).
 */
const SESSIONS_KEY = 'quizmill.solar-system-demo.sessions.v1';
const ATTEMPTS_KEY = 'quizmill.solar-system-demo.attempts.v1';
const tid = (id: string) => `[data-testid="${id}"]`;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto('/');
});

test.describe('readiness check', () => {
  test('is offered from Home, sits questions under the clock with feedback, and ends on a study order', async ({
    page,
  }) => {
    await waitForText(page, 'Solar System Practice');
    // The prompt card asks the question first; the rail's tile is the
    // way back once it is gone.
    await expect(page.locator(tid('check-prompt'))).toContainText('Could you pass Mock exam today?');
    await expect(page.locator(tid('check-card'))).toContainText('10–30 min');
    await page.locator(tid('check-prompt-start')).click();

    await waitForText(page, 'Could you pass Mock exam today?');
    const intro = await bodyText(page);
    expect(intro).toContain('about 6 questions at the real exam');
    expect(intro).toContain('The clock stops the check at 10 min, never later');
    expect(intro).toContain('70%');
    await expect(page.locator(tid('check-budget-10'))).toHaveAttribute('aria-checked', 'true');

    await clickButtonByText(page, 'Start the check');
    await waitForText(page, /Q\s*1\s*\/\s*6/);
    await expect(page.locator(tid('check-clock'))).toHaveText(/^(9:5\d|10:00)$/);

    let answered = 0;
    for (;;) {
      await pickOptionA(page);
      await clickButtonByText(page, 'Check answer');
      answered += 1;
      // Feedback as in practice — the verdict and the explanation.
      await waitForText(page, /Correct\.|Not quite\./);
      const next = page.locator('button', { hasText: /Next question|See results/ }).first();
      const last = (await next.textContent())?.includes('See results');
      await next.click();
      if (last) break;
      expect(answered, 'the deck is the in-scope bank').toBeLessThan(18);
    }
    // Quicker than the exam's pace, so more than the advertised six.
    expect(answered).toBeGreaterThanOrEqual(6);

    await expect(page.locator(tid('check-result'))).toBeVisible();
    await expect(page.locator(tid('check-time-up'))).toHaveCount(0);
    await expect(page.locator(tid('check-verdict'))).toHaveAttribute(
      'data-verdict',
      /ready|likely|borderline|not-ready|no-data/,
    );
    await expect(page.locator(tid('check-score'))).toHaveText(
      new RegExp(`\\d+/${answered} correct`),
    );
    await expect(page.locator(tid('check-domain-planets'))).toHaveAttribute(
      'data-status',
      /solid|weak/,
    );
    await expect(page.locator(tid('check-domain-space-exploration'))).toHaveAttribute(
      'data-status',
      /solid|weak/,
    );
    expect(await bodyText(page)).toContain('Study order');

    const sessions = await readStorage<{ mode?: string; subject: string; endedAt: number | null }[]>(
      page,
      SESSIONS_KEY,
    );
    expect(sessions?.[0]).toMatchObject({ mode: 'check', subject: 'check', questionCount: answered });
    expect(sessions?.[0].endedAt).not.toBeNull();
    const attempts = await readStorage<{ mode?: string; subject: string; questionId: string }[]>(
      page,
      ATTEMPTS_KEY,
    );
    expect(attempts).toHaveLength(answered);
    expect(attempts?.every((a) => a.mode === 'check' && a.subject !== 'check')).toBe(true);
    expect(new Set(attempts?.map((a) => a.questionId)).size).toBe(answered);

    // The sitting counts toward readiness on Progress as ordinary history.
    await page.goto('/progress/');
    await waitForText(page, 'Exam readiness');
    await expect(page.locator(tid('readiness-domain-planets'))).toContainText(/\d+% seen/);

    // Home no longer asks: the check has been sat. The tile remains.
    await page.goto('/');
    await waitForText(page, 'Solar System Practice');
    await expect(page.locator(tid('check-prompt'))).toHaveCount(0);
    await expect(page.locator(tid('check-card'))).toBeVisible();
  });

  test('the prompt card can be closed for good', async ({ page }) => {
    await waitForText(page, 'Solar System Practice');
    await page.locator(tid('check-prompt-dismiss')).click();
    await expect(page.locator(tid('check-prompt'))).toHaveCount(0);
    await page.reload();
    await waitForText(page, 'Solar System Practice');
    await expect(page.locator(tid('check-prompt'))).toHaveCount(0);
    await expect(page.locator(tid('check-card'))).toBeVisible();
  });
});
