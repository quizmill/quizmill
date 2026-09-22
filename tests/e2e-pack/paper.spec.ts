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
  clickButtonByText,
  launchBrowser,
  newPage,
  resetOrigin,
  waitForText,
} from '../e2e/helpers';

/**
 * Paper practice, end to end against the demo pack: compose a sheet,
 * REOPEN it from the list by clicking its row (a real-browser
 * regression: a next/link hash href navigates via pushState and never
 * fires the `hashchange` the page keys off, so only a native anchor
 * works — no unit test drives the router, so it lives here), then mark
 * answers back in and see them recorded.
 */

const ATTEMPTS_KEY = 'quizmill.solar-system-demo.attempts.v1';
const SESSIONS_KEY = 'quizmill.solar-system-demo.sessions.v1';

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
  await page.goto(baseUrl() + '/paper/');
  await resetOrigin(page);
  await page.reload({ waitUntil: 'networkidle0' });
});

afterEach(async () => {
  await resetOrigin(page);
  await page.close();
});

describe('paper practice', () => {
  it('reopens a stored sheet by clicking its row in the list', async () => {
    await clickButtonByText(page, 'Create sheet');
    await page.waitForSelector('[data-testid="paper-sheet"]');

    // The tab title carries the sheet stamp while it's open — it's what
    // browsers use as the "Save as PDF" filename, so every sheet's PDF
    // gets a unique name (code + date).
    const code = await page.$eval(
      '[data-testid="paper-sheet"] .font-mono',
      (el) => el.textContent?.trim(),
    );
    expect(code).toMatch(/^P-/);
    expect(await page.title()).toContain(` - ${code} - `);
    expect(await page.title()).toMatch(/\d{4}-\d{2}-\d{2}$/);

    // Back to the list, then REOPEN via the row — the click that only
    // works with native hash navigation.
    await clickButtonByText(page, 'Sheets');
    await page.waitForSelector('[data-testid="paper-sheet-list"]');
    expect(await page.$('[data-testid="paper-sheet"]')).toBeNull();
    await page.click(`[data-testid="sheet-row-${code}"]`);
    await page.waitForSelector('[data-testid="paper-sheet"]', { timeout: 5000 });
    await waitForText(page, 'Print / PDF');

    // Leaving the sheet restores the app title.
    await clickButtonByText(page, 'Sheets');
    await page.waitForSelector('[data-testid="paper-sheet-list"]');
    expect(await page.title()).not.toContain(String(code));
  });

  it('prints an answer key for the coach under its own PDF name', async () => {
    await clickButtonByText(page, 'Create sheet');
    await page.waitForSelector('[data-testid="paper-sheet"]');
    await page.click('[data-testid="view-key"]');
    await page.waitForSelector('[data-testid="paper-answer-key"]');
    expect(await page.$('[data-testid="paper-sheet"]')).toBeNull();
    expect(await page.title()).toMatch(/ - answer key$/);
    const answers = await page.$$eval('[data-testid="key-answer"]', (els) =>
      els.map((el) => el.textContent?.trim()),
    );
    expect(answers).toHaveLength(10);
    expect(answers.every((a) => /^[A-F](,[A-F])*$/.test(a ?? ''))).toBe(true);
  });

  it('marks a sheet back in and records a paper session', async () => {
    await clickButtonByText(page, 'Create sheet');
    await page.waitForSelector('[data-testid="paper-sheet"]');
    await clickButtonByText(page, 'Mark answers');
    await page.waitForSelector('[data-testid="mark-rows"]');

    await page.click('[aria-label="Question 1: answer A"]');
    await page.click('[aria-label="Question 2: answer B"]');
    await page.click('[data-testid="save-marks"]');
    await page.waitForSelector('[data-testid="mark-saved"]');
    await waitForText(page, /[0-2]\/2 correct/);

    const { attempts, sessions } = await page.evaluate(
      (keys) => ({
        attempts: JSON.parse(localStorage.getItem(keys.a) ?? '[]'),
        sessions: JSON.parse(localStorage.getItem(keys.s) ?? '[]'),
      }),
      { a: ATTEMPTS_KEY, s: SESSIONS_KEY },
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].mode).toBe('paper');
    expect(attempts).toHaveLength(2);
    expect(attempts.every((a: { mode: string }) => a.mode === 'paper')).toBe(true);

    // The list now shows the sheet as marked.
    await page.goto(baseUrl() + '/paper/', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="paper-sheet-list"]');
    await waitForText(page, 'Marked');
  });
});
