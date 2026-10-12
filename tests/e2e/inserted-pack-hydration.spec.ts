import { expect, test } from '@playwright/test';
import { waitForText } from './helpers';

/**
 * An INSERTED pack (the /packs library) as the active one, on an ordinary
 * one-pack build: the prerendered HTML carries the build-time pack and the
 * inline bootstrap swaps the library pack in before React hydrates. That
 * must not surface as a hydration error — React #418 on every Home load
 * for anyone practising an inserted pack (issue #113). The page always
 * recovered visually; the assertion here is the console staying clean.
 */

const INSERTED = {
  manifest: {
    schemaVersion: 2,
    id: 'inserted-hydration-demo',
    title: 'Photosynthesis Crash Course',
    description: 'Inserted from the pack library.',
    homeSubtitle: 'Swapped in before React woke up',
    themeColor: '#3b78e0',
    // Deliberately a DIFFERENT category count from the demo pack, so the
    // server and client trees differ in shape, not just in text.
    categories: [
      { key: 'basics', label: 'Basics' },
      { key: 'light', label: 'Light reactions' },
      { key: 'dark', label: 'Calvin cycle' },
      { key: 'leaf', label: 'Leaf anatomy' },
      { key: 'history', label: 'History of the idea' },
    ],
  },
  questions: ['basics', 'light', 'dark', 'leaf', 'history'].map((key, i) => ({
    id: `inserted-hydration-demo-${key}-001`,
    categoryKey: key,
    difficulty: 2,
    prompt: `Question ${i + 1} about ${key}?`,
    options: [
      { key: 'A', text: 'Mitochondrion' },
      { key: 'B', text: 'Chloroplast' },
      { key: 'C', text: 'Nucleus' },
      { key: 'D', text: 'Ribosome' },
    ],
    correctKey: 'B',
    explanation: 'Chloroplasts are the site of photosynthesis.',
    source: 'generated',
    reviewStatus: 'draft',
  })),
};

let consoleErrors: string[];
let pageErrors: string[];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Insert via the library keys and point the app at the pack — exactly
  // what "Make active" on /packs writes.
  await page.evaluate((p) => {
    localStorage.setItem(`quizmill.packLibrary.pack.${p.manifest.id}.v1`, JSON.stringify(p));
    localStorage.setItem('quizmill.activePackId', p.manifest.id);
  }, INSERTED);
  consoleErrors = [];
  pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
});

function expectNoHydrationErrors() {
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((e) => /Minified React error|Hydration/i.test(e))).toEqual([]);
}

test('hydrates Home without a React hydration error', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await waitForText(page, 'Photosynthesis Crash Course');
  // Let hydration finish and any recoverable error reach the console.
  await page.waitForTimeout(500);

  await expect(page.locator('h1')).toHaveText('Photosynthesis Crash Course');
  await expect(page.locator('a[href*="/practice/?subject="]')).toHaveCount(5);
  expectNoHydrationErrors();
});

// Every pack-scoped page prerenders the build-time pack's title (the
// PackChip eyebrow, Settings' "about this pack"), so each one tripped the
// same error on a hard load — not just Home.
for (const route of ['/progress/', '/stickers/', '/notes/', '/settings/']) {
  test(`hard-loads ${route} without a React hydration error`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'networkidle' });
    await waitForText(page, 'Photosynthesis Crash Course');
    await page.waitForTimeout(500);
    expectNoHydrationErrors();
  });
}
