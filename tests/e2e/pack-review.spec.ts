import { expect, test } from '@playwright/test';
import { waitForText } from './helpers';

/**
 * The pack review page — Settings → Packs → Review questions — against
 * the demo pack (19 questions). A reading of the bank with every answer
 * shown, for judging a pack's quality from inside the app; nothing is
 * recorded as practice.
 */
const tid = (id: string) => `[data-testid="${id}"]`;

test.describe('pack review', () => {
  test('is reached from Settings and shows ten revealed questions', async ({ page }) => {
    await page.goto('/settings/');
    await page.locator(tid('open-pack-review')).click();
    await expect(page).toHaveURL(/\/packs\/review\/$/);
    await waitForText(page, 'Showing 10 of 19 questions');

    const cards = page.locator(tid('review-card'));
    await expect(cards).toHaveCount(10);
    // Every card names its id and review status, and has its answer lit.
    for (let i = 0; i < 10; i++) {
      const card = cards.nth(i);
      await expect(card.locator('code')).toHaveText(/^demo-/);
      await expect(card.locator(tid('review-status-chip'))).toHaveText(/draft|reviewed|approved/);
      await expect(card.getByText('Explanation', { exact: true })).toBeVisible();
      await expect(card.locator('button[disabled].border-success-500').first()).toBeVisible();
      await expect(card.locator(tid('vote-row'))).toBeVisible();
    }
    // Reading is not practising.
    const attempts = await page.evaluate(() =>
      localStorage.getItem('quizmill.solar-system-demo.attempts.v1'),
    );
    expect(attempts).toBeNull();
  });

  test('twenty shows the whole demo pack; drawing again walks the bank before repeating', async ({
    page,
  }) => {
    await page.goto('/packs/review/');
    await waitForText(page, 'Showing 10 of 19 questions');
    const ids = async () =>
      page.locator(tid('review-card')).evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.questionId),
      );
    const first = await ids();

    await page.locator(tid('review-redraw')).click();
    await waitForText(page, 'has been shown — starting over');
    const second = await ids();
    expect(second).toHaveLength(10);
    expect(second.filter((id) => !first.includes(id))).toHaveLength(9);

    await page.locator(tid('review-size-20')).click();
    await expect(page.locator(tid('review-card'))).toHaveCount(19);
    await expect(page.locator(tid('review-size-20'))).toHaveAttribute('aria-pressed', 'true');
  });

  test('a thumbs-down here is an ordinary question vote', async ({ page }) => {
    await page.goto('/packs/review/');
    await waitForText(page, 'Showing 10 of 19 questions');
    const card = page.locator(tid('review-card')).first();
    const id = await card.getAttribute('data-question-id');
    await card.locator(tid('vote-down')).click();
    await card.locator(tid('vote-comment')).fill('Distractor B is also true.');
    await waitForText(page, 'Saved ✓');

    await page.goto('/settings/');
    await waitForText(page, 'Question feedback');
    const browser = page.locator(tid('dev-downvotes'));
    await expect(browser).toContainText(id!);
    await expect(browser).toContainText('Distractor B is also true.');
  });
});
