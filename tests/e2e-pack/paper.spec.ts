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

  it('prints a QR a camera can actually decode, and it opens the marking page', async () => {
    await clickButtonByText(page, 'Create sheet');
    await page.waitForSelector('[data-testid="paper-sheet"] svg path');

    // "Scan" the QR the way a phone does: rasterise the SVG at roughly
    // its printed resolution (36mm at 300dpi ≈ 425px) and run jsQR over
    // the pixels. This is the regression net for payload density and
    // the quiet zone — an unscannable code fails here, not at the
    // kitchen table.
    await page.addScriptTag({ path: 'node_modules/jsqr/dist/jsQR.js' });
    const decoded = await page.evaluate(async () => {
      const svg = document.querySelector('[data-testid="paper-sheet"] svg')!;
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      const loaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      await loaded;
      const SIZE = 425;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const data = ctx.getImageData(0, 0, SIZE, SIZE);
      type JsQr = (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null;
      const result = (window as unknown as { jsQR: JsQr }).jsQR(
        data.data,
        SIZE,
        SIZE,
      );
      return result?.data ?? null;
    });

    expect(decoded).not.toBeNull();
    expect(decoded).toContain('/paper/mark/#s=2.');

    // The decoded URL is the whole loop: opening it lands on marking.
    await page.goto(decoded!, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="mark-rows"]');
    await waitForText(page, /P-[A-Z2-9]{4}/);
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
