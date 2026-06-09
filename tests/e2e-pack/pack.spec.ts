import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type { Browser, Page } from 'puppeteer';
import {
  baseUrl,
  bodyText,
  clickButtonByText,
  launchBrowser,
  newPage,
  resetOrigin,
  waitForText,
} from '../e2e/helpers';

/**
 * End-to-end coverage for the generic pack variant, running against
 * the committed DEMO pack (content/pack-demo — solar system). Assumes
 * the pack-variant static build is in `out/` (the prebuild ensure-pack
 * hook seeds the demo when no other pack is active). If a different
 * pack was activated locally via pack:use, these specs will fail —
 * re-seed with: rm -rf content/pack && npx tsx scripts/ensure-pack.ts
 */

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
  page.on('pageerror', (e) =>
    console.error('[pageerror]', e instanceof Error ? e.message : e),
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console]', msg.text());
  });
  await page.goto(baseUrl() + '/');
  await resetOrigin(page);
  await page.goto(baseUrl() + '/');
});

afterEach(async () => {
  await page.close();
});

describe('pack home page', () => {
  it('renders the manifest title, subtitle, and category cards', async () => {
    await waitForText(page, 'Solar System Practice');
    const body = await bodyText(page);
    expect(body).toContain('Solar System Practice');
    expect(body).toContain('Pick a category');
    expect(body).toContain('Planets & Moons');
    expect(body).toContain('Space Exploration');
    // Manifest weights surface as chips (0.6 / 0.4).
    expect(body).toContain('60%');
    expect(body).toContain('40%');
  });

  it('shows the available question count per category', async () => {
    await waitForText(page, 'questions available');
    const body = await bodyText(page);
    expect(/\d+ questions available/.test(body)).toBe(true);
  });
});

describe('pack practice flow', () => {
  it('runs a complete session and lands on the results screen', async () => {
    await page.goto(baseUrl() + '/practice/planets/');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

    const total = await page.evaluate(() => {
      const m = (document.body.textContent ?? '').match(/Q\s*1\s*\/\s*(\d+)/);
      return m ? Number(m[1]) : 0;
    });
    expect(total).toBeGreaterThan(0);

    for (let i = 0; i < total; i++) {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const aBtn = buttons.find((b) =>
          /^A/.test(b.textContent?.trim() ?? ''),
        );
        if (aBtn) (aBtn as HTMLButtonElement).click();
      });
      await clickButtonByText(page, 'Check answer');
      await waitForText(page, /Correct\.|Not quite\./);
      const isLast = i === total - 1;
      await clickButtonByText(page, isLast ? 'See results' : 'Next question');
    }

    await waitForText(page, 'Practice complete');
    const resultBody = await bodyText(page);
    expect(resultBody).toMatch(new RegExp(`\\d+\\/${total}`));
    expect(resultBody).toMatch(/\d+% correct/);
  }, 60_000);

  it('answered count persists to the home page and the vote row shows in feedback', async () => {
    await page.goto(baseUrl() + '/practice/planets/');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

    // Answer one question and check the feedback panel carries the
    // vote row (question feedback works for pack content too).
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const aBtn = buttons.find((b) => /^A/.test(b.textContent?.trim() ?? ''));
      if (aBtn) (aBtn as HTMLButtonElement).click();
    });
    await clickButtonByText(page, 'Check answer');
    await waitForText(page, /Correct\.|Not quite\./);
    await page.waitForSelector('[data-testid="vote-row"]');

    // Attempts persist under the pack variant's own namespace.
    const attemptsRaw = await page.evaluate(() =>
      localStorage.getItem('quizmill.solar-system-demo.attempts.v1'),
    );
    expect(attemptsRaw).toBeTruthy();
    const attempts = JSON.parse(attemptsRaw as string) as { subject: string }[];
    expect(attempts).toHaveLength(1);
    expect(attempts[0].subject).toBe('planets');
  }, 60_000);
});
