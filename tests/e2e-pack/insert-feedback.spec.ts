import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { buildPackBundle } from '../../tools/pack/bundle';
import { baseUrl, launchBrowser, resetOrigin, waitForText } from '../e2e/helpers';

/**
 * Inserting a pack from a file must give feedback WHERE THE USER IS. The
 * Insert card is the last thing on /packs, so on a laptop the file picker
 * is used scrolled to the bottom of the page — a confirmation rendered at
 * the top goes unseen, and "nothing happened" earns a second insert.
 *
 * Laptop viewport, scrolled to the bottom, pick a bundle: the result must
 * land inside the viewport without the user scrolling, inside the Insert
 * card, and its own Make active must take the app to the new pack.
 */
let browser: Browser;
let page: Page;
let workDir: string;
let bundleFile: string;

function writeFixturePack(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'pack.json'),
    JSON.stringify({
      schemaVersion: 2,
      id: 'feedback-fixture',
      title: 'Insert Feedback Fixture',
      description: 'Fixture pack proving a file insert confirms itself where the user is.',
      homeSubtitle: 'Insert feedback fixture.',
      themeColor: '#654321',
      categories: [{ key: 'shapes', label: 'Shapes' }],
    }),
  );
  const question = (n: number) => ({
    id: `feedback-fixture-shapes-00${n}`,
    categoryKey: 'shapes',
    difficulty: 1,
    prompt: `Fixture question ${n}: which of these has four equal sides?`,
    options: [
      { key: 'A', text: 'A square' },
      { key: 'B', text: 'A circle' },
    ],
    correctKey: 'A',
    explanation: 'A square has four equal sides — this fixture only checks the insert flow.',
    source: 'original',
    reviewStatus: 'draft',
  });
  fs.writeFileSync(
    path.join(dir, 'questions.json'),
    JSON.stringify([question(1), question(2), question(3)]),
  );
}

beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizmill-insert-feedback-'));
  const packDir = path.join(workDir, 'pack');
  writeFixturePack(packDir);
  const built = buildPackBundle(packDir);
  if (!built.ok) throw new Error(built.errors.join('\n'));
  bundleFile = path.join(workDir, 'feedback-fixture.bundle.json');
  fs.writeFileSync(bundleFile, JSON.stringify(built.bundle));
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('insert feedback on a laptop', () => {
  it('confirms a file insert in view, and its Make active opens the new pack', async () => {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.goto(baseUrl() + '/packs/', { waitUntil: 'networkidle0' });
    await resetOrigin(page);
    await page.goto(baseUrl() + '/packs/', { waitUntil: 'networkidle0' });
    await waitForText(page, 'Insert a pack');

    // Where a laptop user is when they reach for Choose files…
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const picker = await page.$('input[data-testid="insert-files"]');
    expect(picker, 'the file input on /packs').toBeTruthy();
    await picker!.uploadFile(bundleFile);

    // The result renders inside the Insert card…
    await page.waitForSelector('[data-testid="insert-result"]', { timeout: 20_000 });
    const where = await page.$eval('[data-testid="insert-result"]', (el) => ({
      text: el.textContent ?? '',
      inInsertCard: Boolean(
        el.closest('section')?.querySelector('h2')?.textContent?.includes('Insert a pack'),
      ),
    }));
    expect(where.text).toContain('Inserted “Insert Feedback Fixture” (3 questions)');
    expect(where.inInsertCard).toBe(true);

    // …and lands inside the viewport without the user scrolling.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="insert-result"]');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      },
      { timeout: 5_000, polling: 100 },
    );

    // The pack is on the shelf as well.
    const onShelf = await page.$('[data-testid="pack-card-feedback-fixture"]');
    expect(onShelf).toBeTruthy();

    // Make active from the panel — one screen from insert to practising.
    await page.click('[data-testid="insert-result-activate"]');
    await page.waitForNavigation({ waitUntil: 'load' }).catch(() => undefined);
    await waitForText(page, 'Active', 20_000);
    const activeCard = await page.$eval(
      '[data-testid="pack-card-feedback-fixture"]',
      (el) => el.textContent ?? '',
    );
    expect(activeCard).toContain('Active');

    // Home now counts the new pack's questions.
    await page.goto(baseUrl() + '/', { waitUntil: 'networkidle0' });
    await waitForText(page, 'Insert Feedback Fixture', 20_000);
    await waitForText(page, '0 of 3 available', 20_000);

    await resetOrigin(page);
    await page.close();
  });
});
