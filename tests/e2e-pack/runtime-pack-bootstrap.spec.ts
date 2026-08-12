import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { baseUrl, bodyText, launchBrowser, newPage, resetOrigin, waitForText } from '../e2e/helpers';

/**
 * The runtime pack-injection bootstrap (src/app/layout.tsx + the seam in
 * src/pack/{runtime,source}.ts): a single static engine deployment renders a
 * pack handed to it at runtime via localStorage['quizmill.activePack'], rather
 * than only the build-time pack. This is what lets quizmill-cloud serve one
 * engine build for every generated pack. Runs against the demo build in out/.
 */

const INJECTED = {
  manifest: {
    schemaVersion: 1,
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

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await newPage(browser);
  await page.goto(baseUrl() + '/');
  await resetOrigin(page);
  await page.goto(baseUrl() + '/');
});

afterEach(async () => {
  await resetOrigin(page);
  await page.close();
});

describe('runtime pack bootstrap', () => {
  it('ships the bootstrap as a parser-executed inline script, not a queued one', async () => {
    // REGRESSION GUARD. `next/script strategy="beforeInteractive"` does NOT
    // inline the code — it serialises it into the `self.__next_s` queue,
    // which the framework runtime flushes at its leisure. That flush RACES
    // the engine chunks' module evaluation, and when a chunk wins,
    // source.ts reads `__QUIZMILL_PACK__` before the bootstrap has set it:
    // the injected pack is silently ignored (no error, no hydration
    // mismatch — the build-time pack just renders). The bootstrap must be a
    // real inline <script> so the HTML parser executes it before any
    // deferred bundle can run.
    const res = await fetch(baseUrl() + '/');
    const html = await res.text();
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1],
    );
    const bootstrap = inlineScripts.find((s) => s.includes('quizmill.activePack'));
    expect(bootstrap, 'pack bootstrap inline script present').toBeDefined();
    expect(bootstrap).toContain('__QUIZMILL_PACK__');
    expect(bootstrap).not.toContain('__next_s'); // queued = the race is back
  });

  it('renders the build-time pack when nothing is injected', async () => {
    // The committed demo pack is the solar system. Assert the visible heading
    // (body text also contains the RSC flight payload, so check the H1).
    await waitForText(page, 'Solar System');
    const h1 = await page.$eval('h1', (h) => h.textContent?.trim() ?? '');
    expect(h1).toContain('Solar System');
  });

  it('injects a runtime pack from localStorage, overriding the build-time pack', async () => {
    await page.evaluate(
      (p) => localStorage.setItem('quizmill.activePack', JSON.stringify(p)),
      INJECTED,
    );
    await page.reload();

    await waitForText(page, 'Photosynthesis Crash Course');
    // The visible heading is the injected pack's title, not the build-time one.
    const h1 = await page.$eval('h1', (h) => h.textContent?.trim() ?? '');
    expect(h1).toBe('Photosynthesis Crash Course');
    expect(await bodyText(page)).toContain('Basics'); // injected category card
  });
});
