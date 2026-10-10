import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { baseUrl, launchBrowser, newPage, resetOrigin, waitForText } from '../e2e/helpers';

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
    schemaVersion: 1,
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

let browser: Browser;
let page: Page;
let consoleErrors: string[];
let pageErrors: string[];

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await newPage(browser);
  consoleErrors = [];
  pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await page.goto(baseUrl() + '/');
  await resetOrigin(page);
  // Insert via the library keys and point the app at the pack — exactly
  // what "Make active" on /packs writes.
  await page.evaluate((p) => {
    localStorage.setItem(`quizmill.packLibrary.pack.${p.manifest.id}.v1`, JSON.stringify(p));
    localStorage.setItem('quizmill.activePackId', p.manifest.id);
  }, INSERTED);
  consoleErrors.length = 0;
  pageErrors.length = 0;
});

afterEach(async () => {
  await resetOrigin(page);
  await page.close();
});

describe('inserted pack active on a one-pack build', () => {
  it('hydrates Home without a React hydration error', async () => {
    await page.goto(baseUrl() + '/', { waitUntil: 'networkidle0' });
    await waitForText(page, 'Photosynthesis Crash Course');
    // Let hydration finish and any recoverable error reach the console.
    await new Promise((r) => setTimeout(r, 500));

    const h1 = await page.$eval('h1', (h) => h.textContent?.trim() ?? '');
    expect(h1).toBe('Photosynthesis Crash Course');
    expect(await page.$$eval('a[href*="/practice/?subject="]', (els) => els.length)).toBe(5);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors.filter((e) => /Minified React error|Hydration/i.test(e))).toEqual([]);
  });

  // Every pack-scoped page prerenders the build-time pack's title (the
  // PackChip eyebrow, Settings' "about this pack"), so each one tripped the
  // same error on a hard load — not just Home.
  it.each(['/progress/', '/stickers/', '/notes/', '/settings/'])(
    'hard-loads %s without a React hydration error',
    async (route) => {
      await page.goto(baseUrl() + route, { waitUntil: 'networkidle0' });
      await waitForText(page, 'Photosynthesis Crash Course');
      await new Promise((r) => setTimeout(r, 500));

      expect(pageErrors).toEqual([]);
      expect(consoleErrors.filter((e) => /Minified React error|Hydration/i.test(e))).toEqual([]);
    },
  );
});
