import { expect, test, type Page, type Route } from '@playwright/test';
import { bodyText, waitForText } from './helpers';

/**
 * Unlocking a pack with a licence key, against a STUBBED endpoint that
 * Playwright answers itself (200 with a bundle for the good key, 403 with
 * a reason for any other). Two set-ups: the plain demo pack, which
 * declares nothing — the route and the Packs entry exist anyway, the key
 * alone goes to the build's default endpoint and the bundle names the
 * pack; and a "sampler" whose manifest hints at its full bank
 * (`upgrade.packId`) on the author's own endpoint (`upgrade.unlockUrl`):
 * links and the Packs entry still send the key alone there, and only the
 * upgrade claim adds `pack=`. `/unlock#key=GOOD` must confirm the unlock
 * and, in a browser tab once Start practising is pressed (the installed app
 * on its own), land on Home with the unlocked pack active and counted — no
 * Packs visit; `#key=BAD` stays put
 * with the refusal and the key entry; the entry under Packs ends the same
 * way as the link. And the key must never be in a URL after load, nor in
 * the console.
 */

const GOOD = 'QM-GOOD-E2E';
const BAD = 'QM-BAD-E2E';
/** The sampler's own endpoint. */
const UNLOCK_BASE = 'https://unlock.test';
/** The build's default endpoint (NEXT_PUBLIC_UNLOCK_URL is unset here). */
const DEFAULT_BASE = 'https://sync.quizmill.dev';

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
  await page.route(`${DEFAULT_BASE}/v1/unlock**`, stubEndpoint);
});

test('the demo pack declares nothing: /unlock still works, the key alone names the pack', async ({
  page,
}) => {
  await page.goto('/');
  await page.goto(`/unlock/#key=${GOOD}`, { waitUntil: 'networkidle' });
  // A browser tab stays on the confirmation until Start practising.
  await expect(page.locator('[data-testid="unlock-unlocked"]')).toHaveText(
    'Unlocked: Solar System Full Course, 7 questions',
    { timeout: 20_000 },
  );
  expect(new URL(page.url()).pathname).toBe('/unlock/');
  await page.click('[data-testid="unlock-start"]');
  await expect(page.locator('h1')).toHaveText('Solar System Full Course', { timeout: 20_000 });
  await waitForText(page, 'Unlocked: 7 questions');
  // The key alone, to the default endpoint — no pack= without a hint.
  expect(endpointHits).toEqual([`${DEFAULT_BASE}/v1/unlock?key=${GOOD}`]);
  expect(page.url()).not.toContain('key=');
  expect(consoleText.join('\n')).not.toContain(GOOD);
  expect(
    await page.evaluate(() => ({
      active: localStorage.getItem('quizmill.activePackId'),
      licence: localStorage.getItem('quizmill.solar-system-full.licence'),
    })),
  ).toEqual({ active: 'solar-system-full', licence: GOOD });

  // And the entry is on /packs for the demo pack too.
  await page.goto('/packs/', { waitUntil: 'networkidle' });
  await waitForText(page, 'Have a licence key?', 20_000);
});

test.describe('a sampler that hints at its full bank on its own endpoint', () => {
  test.beforeEach(async ({ page }) => {
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

  test('/unlock#key=GOOD confirms, then Start practising lands on Home with the unlocked pack active — no Packs visit', async ({
    page,
  }) => {
    await page.goto(`/unlock/#key=${GOOD}`, { waitUntil: 'networkidle' });
    // A browser tab holds the confirmation (with the key, quietly, as a
    // fallback) until the learner presses Start practising.
    const unlocked = page.locator('[data-testid="unlock-unlocked"]');
    await expect(unlocked).toHaveText('Unlocked: Solar System Full Course, 7 questions', {
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="unlock-key-value"]')).toHaveText(GOOD);
    await expect(page.locator('[data-testid="unlock-key-steps"]')).toHaveCount(0);
    await page.waitForTimeout(1_000);
    await expect(unlocked).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/unlock/');
    await page.click('[data-testid="unlock-start"]');
    await expect(page.locator('h1')).toHaveText('Solar System Full Course', { timeout: 20_000 });
    await waitForText(page, 'Unlocked: 7 questions');
    // Home (#191) shows the counts per category card; the full pack has one.
    expect(await bodyText(page)).toContain('7 questions available');

    // One request, to the contract's URL with the key alone — a link names
    // no pack, so the bundle says which it opens — and no key after load.
    expect(endpointHits).toEqual([`${UNLOCK_BASE}/v1/unlock?key=${GOOD}`]);
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

  test('in the installed app, /unlock#key=GOOD shows the unlocking state, never the form, then Home', async ({
    page,
  }) => {
    // The installed app (iOS's flag), and a record of every state the page
    // ever painted — so a form flashing past for one frame still counts.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
      if (!location.pathname.startsWith('/unlock')) return;
      new MutationObserver(() => {
        for (const id of ['unlock-unlocking', 'unlock-unlocked', 'licence-key-form']) {
          if (document.querySelector(`[data-testid="${id}"]`)) {
            sessionStorage.setItem(`e2e.seen.${id}`, '1');
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    // Answer the good key only after a beat, so the in-flight state is up.
    let release: (() => void) | undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route(`${UNLOCK_BASE}/v1/unlock**`, async (route) => {
      await held;
      await stubEndpoint(route);
    });

    await page.goto(`/unlock/#key=${GOOD}`);
    const unlocking = page.locator('[data-testid="unlock-unlocking"]');
    await expect(unlocking).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="unlock-progress"]')).toBeVisible();
    await expect(page.locator('[data-testid="licence-key-form"]')).toHaveCount(0);

    release?.();
    await expect(page.locator('[data-testid="unlock-unlocked"]')).toContainText(
      'Solar System Full Course',
    );
    await expect(page.locator('h1')).toHaveText('Solar System Full Course', { timeout: 20_000 });
    await waitForText(page, 'Unlocked: 7 questions');
    expect(page.url().endsWith('/')).toBe(true);
    expect(endpointHits).toEqual([`${UNLOCK_BASE}/v1/unlock?key=${GOOD}`]);
    expect(page.url()).not.toContain('key=');
    // What /unlock painted on the way: both calm states, never the form.
    expect(
      await page.evaluate(() =>
        ['unlock-unlocking', 'unlock-unlocked', 'licence-key-form'].map(
          (id) => sessionStorage.getItem(`e2e.seen.${id}`) === '1',
        ),
      ),
    ).toEqual([true, true, false]);
  });

  test('/unlock#key=BAD stays put: the refusal, the file fallback, the key entry', async ({
    page,
  }) => {
    await page.goto(`/unlock/#key=${BAD}`, { waitUntil: 'networkidle' });
    await waitForText(page, 'This key has been used on too many devices.', 20_000);
    const body = await bodyText(page);
    expect(body).toContain('You can also insert the file under Packs.');
    await expect(page.locator('[data-testid="unlock-key-value"]')).toHaveText(BAD);
    // A plain browser tab, not the installed app: the copy-your-key steps
    // lead, before the unlock form.
    await expect(page.locator('[data-testid="unlock-key-steps"] li')).toHaveCount(3);
    expect(
      await page.evaluate(() => {
        const steps = document.querySelector('[data-testid="unlock-key"]');
        const form = document.querySelector('[data-testid="licence-key-form"]');
        return !!steps && !!form && !!(steps.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING);
      }),
    ).toBe(true);
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

  test('a purchase from the upgrade card unlocks the app that started it — no /unlock visit', async ({
    page,
  }) => {
    // The upgrade url: GET is the checkout (a page in another tab), POST
    // the claim check — pending at first, then paid with the key.
    const claimsAsked: string[] = [];
    let paid = false;
    await page.context().route('https://example.com/course**', async (route) => {
      const req = route.request();
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'POST',
      };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (req.method() === 'POST') {
        claimsAsked.push(JSON.parse(req.postData() ?? '{}').claim);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: cors,
          body: JSON.stringify(paid ? { status: 'paid', key: GOOD } : { status: 'pending' }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Checkout</h1>' });
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toHaveText('Solar System Sampler', { timeout: 20_000 });
    const [checkout] = await Promise.all([
      page.waitForEvent('popup'),
      page.click('[data-testid="upgrade-card-home"]'),
    ]);
    const claim = new URL(checkout.url()).searchParams.get('claim');
    expect(claim).toMatch(/^[0-9a-f]{32}$/);
    expect(new URL(checkout.url()).searchParams.get('ref')).toBe('solar-sampler-home');

    // Still pending: the app keeps the sampler and keeps asking.
    await expect.poll(() => claimsAsked.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.locator('h1')).toHaveText('Solar System Sampler');

    // Paid in the checkout's layer → the app unlocks on its own.
    paid = true;
    await checkout.close();
    await expect(page.locator('h1')).toHaveText('Solar System Full Course', { timeout: 20_000 });
    await waitForText(page, 'Unlocked: 7 questions');
    expect(new Set(claimsAsked)).toEqual(new Set([claim]));
    expect(endpointHits).toEqual([`${UNLOCK_BASE}/v1/unlock?key=${GOOD}&pack=solar-system-full`]);
    const state = await page.evaluate(() => ({
      active: localStorage.getItem('quizmill.activePackId'),
      licence: localStorage.getItem('quizmill.solar-system-full.licence'),
      claims: localStorage.getItem('quizmill.solar-sampler.upgradeClaims.v1'),
      events: localStorage.getItem('quizmill.solar-sampler.events.v1') ?? '',
    }));
    expect(state.active).toBe('solar-system-full');
    expect(state.licence).toBe(GOOD);
    expect(JSON.parse(state.claims ?? '{}').claims).toEqual([]);
    expect(state.events).not.toContain(claim!);
    expect(consoleText.join('\n')).not.toContain(claim!);
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
});
