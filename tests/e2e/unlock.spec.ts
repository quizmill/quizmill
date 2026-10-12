import { expect, test, type Page, type Route } from '@playwright/test';
import { bodyText, waitForText } from './helpers';

/**
 * Unlocking a pack with a licence key, against a STUBBED endpoint: the
 * active pack is a "sampler" that declares `upgrade.packId` +
 * `upgrade.unlockUrl`, and Playwright answers the endpoint's requests
 * itself (200 with a bundle for the good key, 403 with a reason for any
 * other). `/unlock#key=GOOD` must land on Home with the unlocked pack
 * active and counted — no Packs visit; `#key=BAD` stays put with the
 * refusal and the key entry; the entry under Packs ends the same way as
 * the link. And the key must never be in a URL after load, nor in the
 * console.
 */

const GOOD = 'QM-GOOD-E2E';
const BAD = 'QM-BAD-E2E';
const UNLOCK_BASE = 'https://unlock.test';

/** The sampler: three questions, and the contract for the fuller pack. */
const SAMPLER = {
  manifest: {
    schemaVersion: 2,
    id: 'solar-sampler',
    title: 'Solar System Sampler',
    description: 'A taste of the full course — unlock the rest with a licence key.',
    homeSubtitle: 'Three questions to start with.',
    themeColor: '#3b78e0',
    categories: [{ key: 'planets', label: 'Planets' }],
    upgrade: {
      title: 'Get the full course',
      url: 'https://example.com/course',
      packId: 'solar-system-full',
      unlockUrl: UNLOCK_BASE,
    },
  },
  questions: [1, 2, 3].map((n) => ({
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
  })),
};

/** What the endpoint hands back for the good key. */
const FULL = {
  manifest: {
    schemaVersion: 2,
    id: 'solar-system-full',
    title: 'Solar System Full Course',
    description: 'The fuller edition a licence key unlocks.',
    homeSubtitle: 'Every planet, every moon.',
    themeColor: '#123456',
    categories: [{ key: 'planets', label: 'Planets' }],
  },
  questions: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
    id: `solar-system-full-planets-00${n}`,
    categoryKey: 'planets',
    difficulty: 2,
    prompt: `Full course question ${n}: which planet is the largest?`,
    options: [
      { key: 'A', text: 'Jupiter' },
      { key: 'B', text: 'Mars' },
    ],
    correctKey: 'A',
    explanation: 'Jupiter is the largest planet in the solar system by far.',
    source: 'original',
    reviewStatus: 'draft',
  })),
};

let consoleText: string[];
let endpointHits: string[];

/** Answer the unlock endpoint in-process; nothing else is routed. */
async function stubEndpoint(route: Route): Promise<void> {
  const url = route.request().url();
  endpointHits.push(url);
  const key = new URL(url).searchParams.get('key');
  const cors = { 'access-control-allow-origin': '*' };
  if (key === GOOD) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ...cors, etag: '"1"' },
      body: JSON.stringify(FULL),
    });
    return;
  }
  await route.fulfill({
    status: 403,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify({ error: 'This key has been used on too many devices.' }),
  });
}

/** The value of the key entry. */
function keyInput(page: Page) {
  return page.locator('[data-testid="licence-key-input"]');
}

test.beforeEach(async ({ page }) => {
  consoleText = [];
  endpointHits = [];
  page.on('console', (msg) => consoleText.push(msg.text()));
  await page.route(`${UNLOCK_BASE}/v1/unlock**`, stubEndpoint);
  await page.goto('/');
  // The sampler is the active pack — exactly what "Make active" writes.
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
});

test('/unlock#key=GOOD lands on Home with the unlocked pack active — no Packs visit', async ({
  page,
}) => {
  await page.goto(`/unlock/#key=${GOOD}`, { waitUntil: 'networkidle' });
  // The unlock navigates to Home on its own.
  await expect(page.locator('h1')).toHaveText('Solar System Full Course', { timeout: 20_000 });
  await waitForText(page, 'Unlocked: 7 questions');
  expect(await bodyText(page)).toContain('0 of 7 available');

  // One request, to the contract's URL — and no key anywhere after load.
  expect(endpointHits).toEqual([`${UNLOCK_BASE}/v1/unlock?pack=solar-system-full&key=${GOOD}`]);
  expect(page.url()).not.toContain('key=');
  expect(page.url().endsWith('/')).toBe(true);
  expect(consoleText.join('\n')).not.toContain(GOOD);

  // Active and remembered for this pack; the toast shows exactly once.
  const state = await page.evaluate(() => ({
    active: localStorage.getItem('quizmill.activePackId'),
    licence: localStorage.getItem('quizmill.solar-system-full.licence'),
    toast: sessionStorage.getItem('quizmill.unlocked.v1'),
    events: localStorage.getItem('quizmill.solar-sampler.events.v1') ?? '',
  }));
  expect(state.active).toBe('solar-system-full');
  expect(state.licence).toBe(GOOD);
  expect(state.toast).toBeNull();
  expect(state.events).toContain('pack_unlocked');
  expect(state.events).not.toContain(GOOD);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveText('Solar System Full Course', { timeout: 20_000 });
  await expect(page.locator('[data-testid="unlocked-toast"]')).toHaveCount(0);
});

test('/unlock#key=BAD stays put: the refusal, the file fallback, the key entry', async ({
  page,
}) => {
  await page.goto(`/unlock/#key=${BAD}`, { waitUntil: 'networkidle' });
  await waitForText(page, 'This key has been used on too many devices.', 20_000);
  const body = await bodyText(page);
  expect(body).toContain('You can also insert the file under Packs.');
  expect(body).toContain('Installed the app on your home screen?');
  await expect(page.locator('[data-testid="unlock-key-value"]')).toHaveText(BAD);
  await expect(keyInput(page)).toHaveValue(BAD);

  // The fragment was wiped on load, and nothing was stored.
  expect(page.url()).not.toContain('key=');
  expect(
    await page.evaluate(() => ({
      active: localStorage.getItem('quizmill.activePackId'),
      licence: localStorage.getItem('quizmill.solar-system-full.licence'),
    })),
  ).toEqual({ active: 'solar-sampler', licence: null });
  expect(consoleText.join('\n')).not.toContain(BAD);

  // Fix the key in place: same handler, same ending as the link.
  await keyInput(page).fill(GOOD);
  await expect(keyInput(page)).toHaveValue(GOOD);
  await page.click('[data-testid="licence-key-go"]');
  await waitForText(page, 'Unlocked: 7 questions', 20_000);
  expect(endpointHits).toHaveLength(2);
});

test('Packs → Have a licence key? ends the same way', async ({ page }) => {
  await page.goto('/packs/', { waitUntil: 'networkidle' });
  await waitForText(page, 'Have a licence key?', 20_000);
  await keyInput(page).fill(GOOD);
  await page.click('[data-testid="licence-key-go"]');
  await waitForText(page, 'Unlocked: 7 questions', 20_000);
  await expect(page.locator('h1')).toHaveText('Solar System Full Course');
  expect(page.url()).not.toContain('key=');
  expect(consoleText.join('\n')).not.toContain(GOOD);
  expect(
    await page.evaluate(() => localStorage.getItem('quizmill.solar-system-full.licence')),
  ).toBe(GOOD);
});
