import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { bodyText, waitForText } from './helpers';

/**
 * One pack id, two editions. The app under test is built from the demo
 * pack (`solar-system-demo`, the "sample"); a licence key fetches a
 * fuller bank with the SAME id — every demo question under its own id,
 * plus more — from a stubbed endpoint. From then on the app must show
 * that edition in place of what was compiled in: after the unlock, after
 * a reload, with or without the library pointer naming it (the state a
 * fresh deploy of the app finds), with everything the learner did before
 * still counted, and one card on the shelf. Removing it brings the
 * compiled-in edition back, progress intact. And the same id from a
 * plain file is refused.
 *
 * A second set-up covers the same pair held as a LIBRARY pack (the sample
 * inserted into another app): its manifest names its own id as the pack
 * the upgrade opens, and the upgrade card must go once the key's edition
 * is in.
 */

const GOOD = 'QM-GOOD-EDITION';
const DEFAULT_BASE = 'https://sync.quizmill.dev';
const UNLOCK_BASE = 'https://unlock.test';
const DEMO_ID = 'solar-system-demo';

const demoDir = path.join(__dirname, '..', '..', 'content', 'pack-demo');
const read = (name: string) => JSON.parse(readFileSync(path.join(demoDir, name), 'utf8'));
const demoManifest = read('pack.json');
const demoQuestions: { id: string; categoryKey: string }[] = read('questions.json');
const demoPlanets = demoQuestions.filter((q) => q.categoryKey === 'planets').length;

const EXTRA = 6;
/** The fuller edition: the demo, question for question, plus six more —
 *  and a manifest that still carries an upgrade block naming its own id. */
const FULL = {
  format: 'quizmill-pack-bundle',
  manifest: {
    ...demoManifest,
    upgrade: { title: 'Get the full bank', url: 'https://example.com/full', packId: DEMO_ID },
  },
  questions: [
    ...demoQuestions,
    ...Array.from({ length: EXTRA }, (_, i) => ({
      id: `demo-planets-9${String(i + 1).padStart(2, '0')}`,
      categoryKey: 'planets',
      level: 'basics',
      difficulty: 1,
      prompt: `Unlocked question ${i + 1}: which planet is the largest?`,
      options: [
        { key: 'A', text: 'Jupiter' },
        { key: 'B', text: 'Mars' },
      ],
      correctKey: 'A',
      explanation: 'Jupiter is the largest planet in the solar system by far.',
      source: 'original',
      reviewStatus: 'draft',
    })),
  ],
  scenarios: read('scenarios.json'),
  concepts: read('concepts.json'),
};
const FULL_COUNT = demoQuestions.length + EXTRA;

/** The same pair as library packs: a sample that sells its own id… */
const samplerQuestion = (n: number) => ({
  id: `solar-sampler-planets-00${n}`,
  categoryKey: 'planets',
  difficulty: 1,
  prompt: `Sampler question ${n}: which planet is closest to the Sun?`,
  options: [
    { key: 'A', text: 'Mercury' },
    { key: 'B', text: 'Venus' },
  ],
  correctKey: 'A',
  explanation: 'Mercury is the innermost planet of the solar system.',
  source: 'original',
  reviewStatus: 'draft',
});
const SAMPLER = {
  manifest: {
    schemaVersion: 2,
    id: 'solar-sampler',
    title: 'Solar System Sampler',
    description: 'A taste of the full bank — unlock the rest with a licence key.',
    homeSubtitle: 'Three questions to start with.',
    themeColor: '#3b78e0',
    categories: [{ key: 'planets', label: 'Planets' }],
    upgrade: {
      title: 'Get the full bank',
      url: 'https://example.com/full',
      packId: 'solar-sampler',
      unlockUrl: UNLOCK_BASE,
    },
  },
  questions: [1, 2, 3].map(samplerQuestion),
};
/** …and the edition the key opens: same id, same manifest, seven questions. */
const SAMPLER_FULL = { ...SAMPLER, questions: [1, 2, 3, 4, 5, 6, 7].map(samplerQuestion) };

/** What the learner did on the built-in edition before unlocking. */
const ATTEMPTS = JSON.stringify([
  {
    id: 'a1',
    sessionId: 's1',
    questionId: 'demo-planets-001',
    answeredAt: 1_700_000_000_000,
    selectedAnswer: 'B',
    isCorrect: true,
    timeTakenSeconds: 4,
    subject: 'planets',
    topic: 'demo-planets-001',
    difficulty: 1,
  },
]);

let consoleErrors: string[];

function endpoint(bundle: unknown) {
  return async (route: Route): Promise<void> => {
    const key = new URL(route.request().url()).searchParams.get('key');
    const cors = { 'access-control-allow-origin': '*' };
    if (key === GOOD) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ...cors, etag: '"1"' },
        body: JSON.stringify(bundle),
      });
      return;
    }
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({ error: 'That licence key was not accepted.' }),
    });
  };
}

async function unlockFromPacks(page: Page): Promise<void> {
  await page.goto('/packs/', { waitUntil: 'networkidle' });
  await waitForText(page, 'Have a licence key?', 20_000);
  await page.locator('[data-testid="licence-key-input"]').fill(GOOD);
  await page.click('[data-testid="licence-key-go"]');
}

/** The "N/M answered" line of the Planets category card on Home. */
async function planetsLine(page: Page): Promise<string> {
  return (await page.locator('a', { hasText: 'Planets & Moons' }).first().textContent()) ?? '';
}

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  await page.route(`${DEFAULT_BASE}/v1/unlock**`, endpoint(FULL));
  await page.route(`${UNLOCK_BASE}/v1/unlock**`, endpoint(SAMPLER_FULL));
});

test('a licence key unlocks the built-in pack’s fuller edition under the same id — and it stays', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(
    ([id, attempts]) => {
      localStorage.setItem(`quizmill.${id}.attempts.v1`, attempts);
      localStorage.setItem(
        `quizmill.${id}.notes.v1`,
        JSON.stringify([{ questionId: 'demo-planets-001', text: 'innermost', updatedAt: 1 }]),
      );
    },
    [DEMO_ID, ATTEMPTS],
  );
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveText('Solar System Practice');
  expect(await planetsLine(page)).toContain(`1/${demoPlanets} answered`);

  // Unlock: same title, more questions, the earlier answer still counted.
  await unlockFromPacks(page);
  await waitForText(page, `Unlocked: ${FULL_COUNT} questions`, 20_000);
  await expect(page.locator('h1')).toHaveText('Solar System Practice');
  expect(await planetsLine(page)).toContain(`1/${demoPlanets + EXTRA} answered`);
  // Its manifest still carries the upgrade block; there is nothing left to offer.
  await expect(page.locator('[data-testid="upgrade-card-home"]')).toHaveCount(0);
  const kept = await page.evaluate((id) => {
    return {
      attempts: localStorage.getItem(`quizmill.${id}.attempts.v1`),
      notes: localStorage.getItem(`quizmill.${id}.notes.v1`),
      licence: localStorage.getItem(`quizmill.${id}.licence`),
    };
  }, DEMO_ID);
  expect(kept.attempts).toBe(ATTEMPTS);
  expect(kept.notes).toContain('innermost');
  expect(kept.licence).toBe(GOOD);

  // A reload still shows it…
  await page.reload({ waitUntil: 'networkidle' });
  expect(await planetsLine(page)).toContain(`1/${demoPlanets + EXTRA} answered`);
  // …and so does a load with no pointer naming it: the unlocked edition
  // outranks the compiled-in content on its own, which is what a fresh
  // deploy of the app (new HTML, same storage) relies on.
  await page.evaluate(() => localStorage.removeItem('quizmill.activePackId'));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveText('Solar System Practice');
  expect(await planetsLine(page)).toContain(`1/${demoPlanets + EXTRA} answered`);
  // Never a hydration error: the prerendered page is the other edition.
  expect(consoleErrors.join('\n')).not.toMatch(/hydrat|#418|#423|#425/i);

  // The shelf: one card for the id, built in AND unlocked, the fuller count.
  await page.goto('/packs/', { waitUntil: 'networkidle' });
  const card = page.locator(`[data-testid="pack-card-${DEMO_ID}"]`);
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-testid="unlocked-pack-badge"]')).toHaveText('Unlocked');
  await expect(card.locator('[data-testid="active-pack-badge"]')).toBeVisible();
  await expect(card).toContainText(`${FULL_COUNT} questions`);
  await expect(card).toContainText('1 answer');

  // Removing it: back to the compiled-in edition, progress where it was.
  page.once('dialog', (dialog) => void dialog.accept());
  await card.locator(`[data-testid="eject-${DEMO_ID}"]`).click();
  await expect(card.locator('[data-testid="unlocked-pack-badge"]')).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(card).toContainText(`${demoQuestions.length} questions`);
  await page.goto('/', { waitUntil: 'networkidle' });
  expect(await planetsLine(page)).toContain(`1/${demoPlanets} answered`);
  expect(
    await page.evaluate((id) => localStorage.getItem(`quizmill.${id}.attempts.v1`), DEMO_ID),
  ).toBe(ATTEMPTS);
});

test('the same id from a plain file is refused, before and after unlocking', async ({ page }) => {
  const pick = async () => {
    await page.goto('/packs/', { waitUntil: 'networkidle' });
    await page.locator('[data-testid="insert-files"]').setInputFiles({
      name: 'full.bundle.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(FULL)),
    });
    await expect(page.locator('[data-testid="insert-errors"]')).toContainText(
      'built into this app',
    );
  };
  await pick();
  expect(
    await page.evaluate(() => localStorage.getItem('quizmill.packLibrary.index.v1')),
  ).toBeNull();

  await unlockFromPacks(page);
  await waitForText(page, `Unlocked: ${FULL_COUNT} questions`, 20_000);
  await pick();
  await expect(
    page.locator(`[data-testid="pack-card-${DEMO_ID}"] [data-testid="unlocked-pack-badge"]`),
  ).toHaveCount(1);
});

test('a sample on the shelf that sells its own id: the upgrade card goes once the key’s edition is in', async ({
  page,
}) => {
  await page.goto('/');
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
          categoryCount: 1,
          insertedAt: Date.now(),
        },
      ]),
    );
    localStorage.setItem('quizmill.activePackId', p.manifest.id);
  }, SAMPLER);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveText('Solar System Sampler', { timeout: 20_000 });
  await expect(page.locator('[data-testid="upgrade-card-home"]')).toBeVisible();
  expect(await bodyText(page)).toContain('3 questions available');

  await unlockFromPacks(page);
  await waitForText(page, 'Unlocked: 7 questions', 20_000);
  await expect(page.locator('h1')).toHaveText('Solar System Sampler');
  expect(await bodyText(page)).toContain('7 questions available');
  await expect(page.locator('[data-testid="upgrade-card-home"]')).toHaveCount(0);

  // One card on the shelf for the one id.
  await page.goto('/packs/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="pack-card-solar-sampler"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="pack-card-solar-sampler"]')).toContainText('7 questions');
});
