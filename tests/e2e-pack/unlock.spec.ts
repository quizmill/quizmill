import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, HTTPRequest, Page } from 'puppeteer';
import { baseUrl, launchBrowser, newPage, resetOrigin, waitForText } from '../e2e/helpers';

/**
 * Unlocking a pack with a licence key, against a STUBBED endpoint: the
 * active pack is a "sampler" that declares `upgrade.packId` +
 * `upgrade.unlockUrl`, and Puppeteer answers the endpoint's requests
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

let browser: Browser;
let page: Page;
let consoleText: string[];
let endpointHits: string[];

/** Answer the unlock endpoint in-process; let everything else through. */
function stubEndpoint(req: HTTPRequest): void {
  const url = req.url();
  if (!url.startsWith(`${UNLOCK_BASE}/v1/unlock`)) {
    void req.continue();
    return;
  }
  endpointHits.push(url);
  const key = new URL(url).searchParams.get('key');
  const cors = { 'access-control-allow-origin': '*' };
  if (key === GOOD) {
    void req.respond({
      status: 200,
      contentType: 'application/json',
      headers: { ...cors, etag: '"1"' },
      body: JSON.stringify(FULL),
    });
    return;
  }
  void req.respond({
    status: 403,
    contentType: 'application/json',
    headers: cors,
    body: JSON.stringify({ error: 'This key has been used on too many devices.' }),
  });
}

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await newPage(browser);
  consoleText = [];
  endpointHits = [];
  page.on('console', (msg) => consoleText.push(msg.text()));
  await page.setRequestInterception(true);
  page.on('request', stubEndpoint);
  await page.goto(baseUrl() + '/');
  await resetOrigin(page);
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

afterEach(async () => {
  await resetOrigin(page);
  await page.close();
});

describe('unlock a pack with a licence key', () => {
  it('/unlock#key=GOOD lands on Home with the unlocked pack active — no Packs visit', async () => {
    await page.goto(`${baseUrl()}/unlock/#key=${GOOD}`, { waitUntil: 'networkidle0' });
    // The unlock navigates to Home on its own.
    await waitForText(page, 'Solar System Full Course', 20_000);
    await waitForText(page, 'Unlocked: 7 questions', 10_000);
    expect(await page.$eval('h1', (h) => h.textContent?.trim())).toBe('Solar System Full Course');
    expect(await page.$eval('body', (b) => b.textContent ?? '')).toContain('0 of 7 available');

    // One request, to the contract's URL — and no key anywhere after load.
    expect(endpointHits).toEqual([
      `${UNLOCK_BASE}/v1/unlock?pack=solar-system-full&key=${GOOD}`,
    ]);
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

    await page.reload({ waitUntil: 'networkidle0' });
    await waitForText(page, 'Solar System Full Course', 20_000);
    expect(await page.$('[data-testid="unlocked-toast"]')).toBeNull();
  });

  it('/unlock#key=BAD stays put: the refusal, the file fallback, the key entry', async () => {
    await page.goto(`${baseUrl()}/unlock/#key=${BAD}`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'This key has been used on too many devices.', 20_000);
    const body = await page.$eval('body', (b) => b.textContent ?? '');
    expect(body).toContain('You can also insert the file under Packs.');
    expect(body).toContain('Installed the app on your home screen?');
    expect(await page.$eval('[data-testid="unlock-key-value"]', (el) => el.textContent)).toBe(BAD);
    expect(
      await page.$eval('[data-testid="licence-key-input"]', (el) => (el as HTMLInputElement).value),
    ).toBe(BAD);

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
    await page.click('[data-testid="licence-key-input"]');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.type('[data-testid="licence-key-input"]', GOOD);
    expect(
      await page.$eval('[data-testid="licence-key-input"]', (el) => (el as HTMLInputElement).value),
    ).toBe(GOOD);
    await page.click('[data-testid="licence-key-go"]');
    await waitForText(page, 'Unlocked: 7 questions', 20_000);
    expect(endpointHits).toHaveLength(2);
  });

  it('Packs → Have a licence key? ends the same way', async () => {
    await page.goto(`${baseUrl()}/packs/`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'Have a licence key?', 20_000);
    await page.type('[data-testid="licence-key-input"]', GOOD);
    await page.click('[data-testid="licence-key-go"]');
    await waitForText(page, 'Unlocked: 7 questions', 20_000);
    expect(await page.$eval('h1', (h) => h.textContent?.trim())).toBe('Solar System Full Course');
    expect(page.url()).not.toContain('key=');
    expect(consoleText.join('\n')).not.toContain(GOOD);
    expect(
      await page.evaluate(() => localStorage.getItem('quizmill.solar-system-full.licence')),
    ).toBe(GOOD);
  });
});
