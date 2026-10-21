import { expect, test, type Page, type Route } from '@playwright/test';
import { bodyText, readStorage, seedAttempts, waitForText } from './helpers';

/**
 * Unlocked packs update themselves, against a STUBBED unlock endpoint that
 * Playwright answers itself: on app open the app asks about every
 * inserted pack with a stored licence key, `If-None-Match: "<version>"`.
 * A stale version gets the author's newer bundle (200) → the pack is
 * re-inserted under the same id, the learner's answered questions still
 * count, and Home says "Updated: now N questions" once. The same version
 * gets a 304 and nothing happens. A dead network shows no error and
 * leaves the pack due for the next open.
 */

const KEY = 'QL-GOOD-E2E-KEY1';
/** The build's default endpoint (NEXT_PUBLIC_UNLOCK_URL is unset here). */
const DEFAULT_BASE = 'https://sync.quizmill.dev';
const PACK_ID = 'solar-system-full';

function fullPack(count: number) {
  return {
    manifest: {
      schemaVersion: 2,
      id: PACK_ID,
      title: 'Solar System Full Course',
      description: 'The fuller edition a licence key unlocks.',
      homeSubtitle: 'Every planet, every moon.',
      themeColor: '#123456',
      categories: [{ key: 'planets', label: 'Planets' }],
    },
    questions: Array.from({ length: count }, (_, i) => ({
      id: `${PACK_ID}-planets-00${i + 1}`,
      categoryKey: 'planets',
      difficulty: 2,
      prompt: `Full course question ${i + 1}: which planet is the largest?`,
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
}

/** What the device holds, and what the author has since published. */
const HELD = fullPack(3);
const PUBLISHED = fullPack(7);
const PUBLISHED_VERSION = '2';

let consoleText: string[];
let hits: { url: string; ifNoneMatch: string | undefined; status: number }[];

/** The endpoint: 304 for the published version, else the published bundle. */
async function stubEndpoint(route: Route): Promise<void> {
  const req = route.request();
  const ifNoneMatch = req.headers()['if-none-match'];
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'etag' };
  const etag = `"${PUBLISHED_VERSION}"`;
  if (ifNoneMatch === etag) {
    hits.push({ url: req.url(), ifNoneMatch, status: 304 });
    await route.fulfill({ status: 304, headers: { ...cors, etag } });
    return;
  }
  hits.push({ url: req.url(), ifNoneMatch, status: 200 });
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { ...cors, etag },
    body: JSON.stringify(PUBLISHED),
  });
}

/** Put the held pack on the shelf, active, with its licence and one answer. */
async function seedUnlockedPack(page: Page, packVersion: string): Promise<void> {
  await page.evaluate(
    ({ pack, key, version }) => {
      localStorage.setItem(`quizmill.packLibrary.pack.${pack.manifest.id}.v1`, JSON.stringify(pack));
      localStorage.setItem(
        'quizmill.packLibrary.index.v1',
        JSON.stringify([
          {
            id: pack.manifest.id,
            title: pack.manifest.title,
            description: pack.manifest.description,
            themeColor: pack.manifest.themeColor,
            questionCount: pack.questions.length,
            categoryCount: 1,
            insertedAt: Date.now(),
            origin: 'licence key · sync.quizmill.dev',
            packVersion: version,
          },
        ]),
      );
      localStorage.setItem('quizmill.activePackId', pack.manifest.id);
      localStorage.setItem(`quizmill.${pack.manifest.id}.licence`, key);
    },
    { pack: HELD, key: KEY, version: packVersion },
  );
  await seedAttempts(
    page,
    [{ questionId: `${PACK_ID}-planets-001`, subject: 'planets', topic: 'planets', isCorrect: true, agoMs: 60_000 }],
    `quizmill.${PACK_ID}.`,
  );
}

test.beforeEach(async ({ page }) => {
  consoleText = [];
  hits = [];
  page.on('console', (msg) => consoleText.push(msg.text()));
  await page.goto('/');
  // Seed only once this first page's app-open effects have run: the sweep
  // reads the shelf in the same effect pass that records `app_open`, so
  // from here on it has seen an empty shelf and will not ask about the
  // pack seeded below (the test's own navigation does that, exactly once).
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('quizmill.solar-system-demo.events.v1') ?? ''))
    .toContain('app_open');
});

test('a stale version: the newer bundle is fetched, Home shows the new count, progress is kept', async ({
  page,
}) => {
  await page.route(`${DEFAULT_BASE}/v1/unlock**`, stubEndpoint);
  await seedUnlockedPack(page, '1');
  // Only `commit`: the update reloads Home moments after it settles, which
  // would abort a longer wait.
  await page.goto('/', { waitUntil: 'commit' });

  // The active pack was updated under the page: Home reloads once and says so.
  await waitForText(page, 'Updated: now 7 questions', 20_000);
  await expect(page.locator('h1')).toHaveText('Solar System Full Course');
  // The seeded answer still counts — against the new bank.
  expect(await bodyText(page)).toContain('1/7 answered');

  // One request, with the held version, to the contract's URL.
  expect(hits).toEqual([
    {
      url: `${DEFAULT_BASE}/v1/unlock?key=${KEY}&pack=${PACK_ID}`,
      ifNoneMatch: '"1"',
      status: 200,
    },
  ]);
  expect(consoleText.join('\n')).not.toContain(KEY);
  expect(page.url()).not.toContain('key=');

  const index = await readStorage<{ id: string; packVersion?: string; questionCount: number }[]>(
    page,
    'quizmill.packLibrary.index.v1',
  );
  expect(index).toHaveLength(1);
  expect(index![0]).toMatchObject({ id: PACK_ID, packVersion: PUBLISHED_VERSION, questionCount: 7 });
  const state = await page.evaluate((id) => ({
    licence: localStorage.getItem(`quizmill.${id}.licence`),
    attempts: localStorage.getItem(`quizmill.${id}.attempts.v1`) ?? '',
    events: localStorage.getItem(`quizmill.${id}.events.v1`) ?? '',
    check: localStorage.getItem(`quizmill.${id}.packUpdate.v1`) ?? '',
    notice: sessionStorage.getItem('quizmill.packUpdated.v1'),
  }), PACK_ID);
  expect(state.licence).toBe(KEY);
  expect(state.attempts).toContain(`${PACK_ID}-planets-001`);
  expect(state.events).toContain('pack_updated');
  expect(state.events).not.toContain(KEY);
  expect(state.check).toContain('checkedAt');
  expect(state.notice).toBeNull();

  // Opening again the same day: no request, no second notice.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveText('Solar System Full Course');
  await expect(page.locator('[data-testid="pack-updated-notice"]')).toHaveCount(0);
  expect(hits).toHaveLength(1);
});

test('the same version: a 304, no body fetched, nothing on Home', async ({ page }) => {
  await page.route(`${DEFAULT_BASE}/v1/unlock**`, stubEndpoint);
  await seedUnlockedPack(page, PUBLISHED_VERSION);
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveText('Solar System Full Course');
  // The check has run once the record is written.
  await expect
    .poll(() => page.evaluate((id) => localStorage.getItem(`quizmill.${id}.packUpdate.v1`), PACK_ID), {
      timeout: 20_000,
    })
    .toContain('checkedAt');

  expect(hits).toEqual([
    {
      url: `${DEFAULT_BASE}/v1/unlock?key=${KEY}&pack=${PACK_ID}`,
      ifNoneMatch: `"${PUBLISHED_VERSION}"`,
      status: 304,
    },
  ]);
  await expect(page.locator('[data-testid="pack-updated-notice"]')).toHaveCount(0);
  expect(await bodyText(page)).toContain('1/3 answered');
  const index = await readStorage<{ questionCount: number }[]>(page, 'quizmill.packLibrary.index.v1');
  expect(index![0].questionCount).toBe(3);
  expect(consoleText.join('\n')).not.toContain(KEY);
});

test('offline: no error shown, and the pack stays due for the next open', async ({ page }) => {
  // The If-None-Match header makes the request non-simple, so the browser
  // may send a CORS preflight first — count only the GET itself.
  let attempted = 0;
  await page.route(`${DEFAULT_BASE}/v1/unlock**`, (route) => {
    if (route.request().method() === 'GET') attempted++;
    return route.abort('internetdisconnected');
  });
  await seedUnlockedPack(page, '1');
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveText('Solar System Full Course');
  await expect.poll(() => attempted, { timeout: 20_000 }).toBe(1);

  // What the learner sees (the body also carries Next's script payload).
  const main = (await page.locator('main').textContent()) ?? '';
  expect(main).toContain('1/3 answered');
  expect(main).not.toMatch(/could not reach|error|failed/i);
  await expect(page.locator('[data-testid="pack-updated-notice"]')).toHaveCount(0);
  expect(await page.evaluate((id) => localStorage.getItem(`quizmill.${id}.packUpdate.v1`), PACK_ID)).toBeNull();
  const index = await readStorage<{ packVersion?: string }[]>(page, 'quizmill.packLibrary.index.v1');
  expect(index![0].packVersion).toBe('1');
});
