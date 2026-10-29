import { expect, test, type Page } from '@playwright/test';

/**
 * An inserted pack (the /packs library, or a bundle a licence key just
 * unlocked) on a hard load: the static HTML was prerendered from the
 * BUILD-TIME pack, and it sits on screen until the engine bundle has
 * downloaded and React has swapped the inserted pack in. On a phone that is
 * long enough to see the build-time pack's title and categories flash past
 * before the pack the learner just unlocked appears. The page must stay
 * blank instead until the live tree takes over.
 *
 * The engine chunks are held back here so the gap is as wide as a slow
 * phone's, and deterministic.
 */

const INSERTED = {
  manifest: {
    schemaVersion: 2,
    id: 'inserted-no-flash-demo',
    title: 'Photosynthesis Crash Course',
    description: 'Inserted from the pack library.',
    themeColor: '#3b78e0',
    categories: [{ key: 'basics', label: 'Basics' }],
  },
  questions: [
    {
      id: 'inserted-no-flash-demo-basics-001',
      categoryKey: 'basics',
      difficulty: 2,
      prompt: 'Where does photosynthesis happen?',
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
    },
  ],
};

const BUILD_TIME_TITLE = 'Solar System Practice';

/** Hold every engine chunk until the returned release() is called. */
async function holdChunks(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/_next/static/chunks/**', async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

test('a hard load with an inserted pack never paints the build-time pack', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((p) => {
    localStorage.setItem(`quizmill.packLibrary.pack.${p.manifest.id}.v1`, JSON.stringify(p));
    localStorage.setItem('quizmill.activePackId', p.manifest.id);
  }, INSERTED);

  const release = await holdChunks(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // The prerendered Home is in the DOM, but must not be on screen.
  await expect(page.locator('h1')).toHaveText(BUILD_TIME_TITLE);
  await expect(page.locator('h1')).toBeHidden();

  release();
  await expect(page.locator('h1')).toHaveText('Photosynthesis Crash Course');
  await expect(page.locator('h1')).toBeVisible();
});

test('with no inserted pack the prerendered Home shows before the bundle loads', async ({ page }) => {
  const release = await holdChunks(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText(BUILD_TIME_TITLE);
  await expect(page.locator('h1')).toBeVisible();
  release();
});

test('a bundle that never loads still reveals the page', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((p) => {
    localStorage.setItem(`quizmill.packLibrary.pack.${p.manifest.id}.v1`, JSON.stringify(p));
    localStorage.setItem('quizmill.activePackId', p.manifest.id);
  }, INSERTED);

  const release = await holdChunks(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toBeHidden();
  // A safety net, not the normal path: if the engine never takes over, the
  // prerendered page comes back rather than leaving a blank screen.
  await expect(page.locator('h1')).toBeVisible({ timeout: 8_000 });
  release();
});
