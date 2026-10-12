import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { writeFixtureBundle } from './fixtures';
import { waitForText } from './helpers';

/**
 * Inserting a pack from a file must give feedback WHERE THE USER IS. The
 * Insert card is the last thing on /packs, so on a laptop the file picker
 * is used scrolled to the bottom of the page — a confirmation rendered at
 * the top goes unseen, and "nothing happened" earns a second insert.
 *
 * Laptop viewport, scrolled to the bottom, pick a bundle: the result must
 * land inside the viewport without the user scrolling, inside the Insert
 * card, and its own Make active must take the app to the new pack.
 */
let workDir: string;
let bundleFile: string;

test.use({ viewport: { width: 1280, height: 800 } });

test.beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizmill-insert-feedback-'));
  bundleFile = writeFixtureBundle(workDir, {
    id: 'feedback-fixture',
    title: 'Insert Feedback Fixture',
    categoryKey: 'shapes',
    questionCount: 3,
  });
});

test.afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

test('confirms a file insert in view, and its Make active opens the new pack', async ({ page }) => {
  await page.goto('/packs/', { waitUntil: 'networkidle' });
  await waitForText(page, 'Insert a pack');

  // Where a laptop user is when they reach for Choose files…
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.locator('input[data-testid="insert-files"]').setInputFiles(bundleFile);

  // The result renders inside the Insert card…
  const result = page.locator('[data-testid="insert-result"]');
  await expect(result).toContainText('Inserted “Insert Feedback Fixture” (3 questions)', {
    timeout: 20_000,
  });
  const inInsertCard = await result.evaluate((el) =>
    Boolean(el.closest('section')?.querySelector('h2')?.textContent?.includes('Insert a pack')),
  );
  expect(inInsertCard).toBe(true);

  // …and lands inside the viewport without the user scrolling.
  await expect(result).toBeInViewport({ ratio: 1, timeout: 5_000 });

  // The pack is on the shelf as well.
  await expect(page.locator('[data-testid="pack-card-feedback-fixture"]')).toHaveCount(1);

  // Make active from the panel — one screen from insert to practising.
  await Promise.all([
    page.waitForEvent('load'),
    page.click('[data-testid="insert-result-activate"]'),
  ]);
  await expect(page.locator('[data-testid="pack-card-feedback-fixture"]')).toContainText('Active', {
    timeout: 20_000,
  });

  // Home now counts the new pack's questions.
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForText(page, 'Insert Feedback Fixture', 20_000);
  await waitForText(page, '0 of 3 available', 20_000);
});
