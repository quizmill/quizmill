import { expect, test } from '@playwright/test';
import { waitForText } from './helpers';

/**
 * The runtime pack-injection bootstrap (src/app/layout.tsx + the seam in
 * src/pack/{runtime,source}.ts): a single static engine deployment renders a
 * pack handed to it at runtime via localStorage['quizmill.activePack'], rather
 * than only the build-time pack. This is what lets quizmill-cloud serve one
 * engine build for every generated pack. Runs against the demo build in out/.
 */

const INJECTED = {
  manifest: {
    schemaVersion: 2,
    id: 'injected-bootstrap-demo',
    title: 'Photosynthesis Crash Course',
    description: 'Injected at runtime.',
    homeSubtitle: 'Handed to the engine at boot',
    themeColor: '#3b78e0',
    categories: [{ key: 'basics', label: 'Basics' }],
  },
  questions: [
    {
      id: 'injected-bootstrap-demo-basics-001',
      categoryKey: 'basics',
      difficulty: 2,
      prompt: 'Which organelle carries out photosynthesis in plant cells?',
      options: [
        { key: 'A', text: 'Mitochondrion' },
        { key: 'B', text: 'Chloroplast' },
        { key: 'C', text: 'Nucleus' },
        { key: 'D', text: 'Ribosome' },
      ],
      correctKey: 'B',
      explanation:
        'Chloroplasts contain chlorophyll and are the site of photosynthesis; mitochondria run respiration.',
      source: 'generated',
      reviewStatus: 'draft',
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('ships the bootstrap as a parser-executed inline script, not a queued one', async ({ request }) => {
  // REGRESSION GUARD. `next/script strategy="beforeInteractive"` does NOT
  // inline the code — it serialises it into the `self.__next_s` queue,
  // which the framework runtime flushes at its leisure. That flush RACES
  // the engine chunks' module evaluation, and when a chunk wins,
  // source.ts reads `__QUIZMILL_PACK__` before the bootstrap has set it:
  // the injected pack is silently ignored (no error, no hydration
  // mismatch — the build-time pack just renders). The bootstrap must be a
  // real inline <script> so the HTML parser executes it before any
  // deferred bundle can run.
  const html = await (await request.get('/')).text();
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  );
  const bootstrap = inlineScripts.find((s) => s.includes('quizmill.activePack'));
  expect(bootstrap, 'pack bootstrap inline script present').toBeDefined();
  expect(bootstrap).toContain('__QUIZMILL_PACK__');
  expect(bootstrap).not.toContain('__next_s'); // queued = the race is back
});

test('renders the build-time pack when nothing is injected', async ({ page }) => {
  // The committed demo pack is the solar system. Assert the visible heading
  // (body text also contains the RSC flight payload, so check the H1).
  await expect(page.locator('h1')).toContainText('Solar System');
});

test('injects a runtime pack from localStorage, overriding the build-time pack', async ({ page }) => {
  await page.evaluate(
    (p) => localStorage.setItem('quizmill.activePack', JSON.stringify(p)),
    INJECTED,
  );
  await page.reload();

  // The visible heading is the injected pack's title, not the build-time one.
  await expect(page.locator('h1')).toHaveText('Photosynthesis Crash Course');
  await waitForText(page, 'Basics'); // injected category card
});

test('resolves the pack-library pointer (activePackId → stored pack)', async ({ page }) => {
  // The in-app pack library (/packs) stores inserted packs under
  // quizmill.packLibrary.pack.<id>.v1 and activates one by writing only
  // the quizmill.activePackId pointer — same bootstrap, no duplicated
  // JSON blob.
  await page.evaluate((p) => {
    localStorage.setItem(`quizmill.packLibrary.pack.${p.manifest.id}.v1`, JSON.stringify(p));
    localStorage.setItem('quizmill.activePackId', p.manifest.id);
  }, INJECTED);
  await page.reload();

  await expect(page.locator('h1')).toHaveText('Photosynthesis Crash Course');
});

test('switches packs end-to-end from the /packs shelf', async ({ page }) => {
  // Insert via the library keys, then drive the UI: /packs shows the
  // shelf, "Make active" swaps the app, ejecting returns to the built-in
  // pack — progress keys are left alone throughout.
  await page.evaluate((p) => {
    localStorage.setItem(`quizmill.packLibrary.pack.${p.manifest.id}.v1`, JSON.stringify(p));
    localStorage.setItem(
      'quizmill.packLibrary.index.v1',
      JSON.stringify([
        {
          id: p.manifest.id,
          title: p.manifest.title,
          description: p.manifest.description,
          themeColor: p.manifest.themeColor,
          questionCount: p.questions.length,
          categoryCount: p.manifest.categories.length,
          insertedAt: 1,
        },
      ]),
    );
  }, INJECTED);
  await page.goto('/packs/');
  await waitForText(page, 'Photosynthesis Crash Course');

  // Make active reloads the app bound to the chosen pack.
  await Promise.all([
    page.waitForEvent('load'),
    page.click(`[data-testid="activate-${INJECTED.manifest.id}"]`),
  ]);
  await expect(page.locator('[data-testid="active-pack-badge"]')).toHaveCount(1);
  await expect(page.locator(`[data-testid="pack-card-${INJECTED.manifest.id}"]`)).toContainText(
    'Active',
  );

  // Home now renders the injected pack.
  await page.goto('/');
  await waitForText(page, 'Photosynthesis Crash Course');
});
