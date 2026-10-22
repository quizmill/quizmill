import { expect, test } from '@playwright/test';
import { bodyText, clickButtonByText, pickOptionA, readStorage, waitForText } from './helpers';

/**
 * The readiness check against the demo pack: its mock exam spans two
 * weighted domains, so one check is three questions from each — six in
 * all — with feedback after every answer, then the result page.
 */
const SESSIONS_KEY = 'quizmill.solar-system-demo.sessions.v1';
const ATTEMPTS_KEY = 'quizmill.solar-system-demo.attempts.v1';
const tid = (id: string) => `[data-testid="${id}"]`;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto('/');
});

test.describe('readiness check', () => {
  test('is offered from Home, sits six questions with feedback, and ends on a study order', async ({
    page,
  }) => {
    await waitForText(page, 'Solar System Practice');
    await page.locator(tid('check-card')).click();

    await waitForText(page, 'Could you pass Mock exam today?');
    const intro = await bodyText(page);
    expect(intro).toContain('6 questions spread across all 2 domains');
    expect(intro).toContain('70%');

    await clickButtonByText(page, 'Start the check');
    await waitForText(page, /Q\s*1\s*\/\s*6/);

    for (let i = 0; i < 6; i++) {
      await pickOptionA(page);
      await clickButtonByText(page, 'Check answer');
      // Feedback as in practice — the verdict and the explanation.
      await waitForText(page, /Correct\.|Not quite\./);
      await clickButtonByText(page, i === 5 ? 'See results' : 'Next question');
    }

    await expect(page.locator(tid('check-result'))).toBeVisible();
    await expect(page.locator(tid('check-verdict'))).toHaveAttribute(
      'data-verdict',
      /ready|likely|borderline|not-ready|no-data/,
    );
    await expect(page.locator(tid('check-score'))).toHaveText(/\d\/6 correct/);
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
    expect(sessions?.[0]).toMatchObject({ mode: 'check', subject: 'check' });
    expect(sessions?.[0].endedAt).not.toBeNull();
    const attempts = await readStorage<{ mode?: string; subject: string; questionId: string }[]>(
      page,
      ATTEMPTS_KEY,
    );
    expect(attempts).toHaveLength(6);
    expect(attempts?.every((a) => a.mode === 'check' && a.subject !== 'check')).toBe(true);
    expect(new Set(attempts?.map((a) => a.questionId)).size).toBe(6);

    // The sitting counts toward readiness on Progress as ordinary history.
    await page.goto('/progress/');
    await waitForText(page, 'Exam readiness');
    await expect(page.locator(tid('readiness-domain-planets'))).toContainText(/\d+% seen/);
  });
});
