import { expect, test } from '@playwright/test';
import { bodyText, clickButtonByText, pickOptionA, readStorage, waitForText } from './helpers';

/**
 * The timed exam against the demo pack: its manifest declares a 9-question,
 * 15-minute mock exam and holds 9 Advanced questions, so one sitting is 9
 * questions in 15:00.
 */
const SESSIONS_KEY = 'quizmill.solar-system-demo.sessions.v1';
const ATTEMPTS_KEY = 'quizmill.solar-system-demo.attempts.v1';
const tid = (id: string) => `[data-testid="${id}"]`;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto('/');
});

test.describe('timed exam', () => {
  test('is offered from Home and sits a full round against the clock', async ({ page }) => {
    await waitForText(page, 'Solar System Practice');
    await page.locator(tid('exam-card')).click();

    await waitForText(page, 'Start exam');
    const intro = await bodyText(page);
    expect(intro).toContain('9');
    expect(intro).toContain('15:00');
    expect(intro).toContain('70%');

    await clickButtonByText(page, 'Start exam');
    await expect(page.locator(tid('exam-clock'))).toHaveText(/1[45]:[0-5]\d/);

    // Pause hides the question; resume brings it back.
    await clickButtonByText(page, 'Pause');
    await expect(page.locator(tid('exam-paused'))).toBeVisible();
    await clickButtonByText(page, 'Resume');
    await expect(page.locator(tid('exam-paused'))).toHaveCount(0);

    for (let i = 0; i < 9; i++) {
      await pickOptionA(page);
      // No feedback between questions: the next question appears directly.
      await clickButtonByText(page, i === 8 ? 'Finish exam' : 'Next question');
    }

    await waitForText(page, 'Exam complete');
    await expect(page.locator(tid('exam-verdict'))).toHaveText(/Passed|Not passed/);
    expect(await bodyText(page)).toMatch(/\d\/9/);

    const sessions = await readStorage<{ mode?: string; endedAt: number | null }[]>(
      page,
      SESSIONS_KEY,
    );
    expect(sessions?.[0]).toMatchObject({ mode: 'exam' });
    expect(sessions?.[0].endedAt).not.toBeNull();
    const attempts = await readStorage<{ mode?: string }[]>(page, ATTEMPTS_KEY);
    expect(attempts).toHaveLength(9);
    expect(attempts?.every((a) => a.mode === 'exam')).toBe(true);
  });
});
