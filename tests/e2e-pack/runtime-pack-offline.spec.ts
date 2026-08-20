import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import {
  launchBrowser,
  newPage,
  startStaticServer,
  waitForText,
  type Server,
} from '../e2e/helpers';

/**
 * Offline images for RUNTIME-INSERTED packs. The pack's JSON lives in
 * localStorage, but its images live on the pack's origin — so at insert
 * time they are prefetched into the deploy-independent PACK_ASSETS_CACHE
 * (src/lib/packAssets.ts) and the service worker serves them from it.
 *
 * This test inserts a fixture pack from a second local server (a plain
 * static host — deliberately NOT GitHub), then stops BOTH servers and
 * proves a question image still renders. Real servers are stopped rather
 * than CDP-offline-emulated for the same reason as offline.spec.ts.
 */
const APP_PORT = 4332;
const PACK_PORT = 4333;

let browser: Browser;
let page: Page;
let appServer: Server | undefined;
let packServer: Server | undefined;
let packDir: string;

/** A minimal visual pack: one category, every question carries an image. */
function writeFixturePack(dir: string): void {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
    '<rect width="40" height="40" fill="#fffdf6"/><circle cx="20" cy="20" r="12" fill="#26221b"/></svg>';
  fs.writeFileSync(path.join(dir, 'assets', 'dot.svg'), svg);
  fs.writeFileSync(
    path.join(dir, 'pack.json'),
    JSON.stringify({
      schemaVersion: 2,
      id: 'offline-fixture',
      title: 'Offline Fixture Pack',
      description: 'Fixture pack proving runtime-inserted images work offline.',
      homeSubtitle: 'Offline images fixture.',
      themeColor: '#123456',
      categories: [{ key: 'dots', label: 'Dots' }],
    }),
  );
  const question = (n: number) => ({
    id: `offline-fixture-dots-00${n}`,
    categoryKey: 'dots',
    difficulty: 1,
    prompt: 'What shape is shown in the figure above?',
    image: 'dot.svg',
    options: [
      { key: 'A', text: 'A circle' },
      { key: 'B', text: 'A square' },
    ],
    correctKey: 'A',
    explanation:
      'The figure shows a filled circle — this fixture only checks that the image itself renders offline.',
    source: 'original',
    reviewStatus: 'draft',
  });
  fs.writeFileSync(
    path.join(dir, 'questions.json'),
    JSON.stringify([question(1), question(2)]),
  );
}

beforeAll(async () => {
  packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizmill-offline-pack-'));
  writeFixturePack(packDir);
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
  if (appServer) await appServer.stop();
  if (packServer) await packServer.stop();
  fs.rmSync(packDir, { recursive: true, force: true });
});

describe('runtime-inserted pack images offline', () => {
  it(
    'inserted pack still shows its question images with the network gone',
    { timeout: 90_000 },
    async () => {
      appServer = await startStaticServer(APP_PORT);
      packServer = await startStaticServer(PACK_PORT, { dir: packDir, cors: true });
      page = await newPage(browser);

      // Install the SW and wait for the precache, as offline.spec.ts does.
      await page.goto(`${appServer.url}/`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(
        async () => {
          if (!navigator.serviceWorker?.controller) return false;
          const hit = await caches.match('/practice/', { ignoreSearch: true });
          return Boolean(hit);
        },
        { timeout: 30_000, polling: 500 },
      );

      // Insert the pack by URL on /packs and wait for the offline-prefetch
      // confirmation ("1 of 1 images saved for offline use" — the two
      // questions share one image).
      await page.goto(`${appServer.url}/packs/`, { waitUntil: 'networkidle0' });
      await page.type('input[placeholder*="github.com"]', `http://127.0.0.1:${PACK_PORT}`);
      const fetchBtn = await page.$$('button').then(async (btns) => {
        for (const b of btns) {
          if ((await b.evaluate((el) => el.textContent?.trim())) === 'Fetch') return b;
        }
        return null;
      });
      expect(fetchBtn, 'the Fetch button on /packs').toBeTruthy();
      await fetchBtn!.click();
      await waitForText(page, /images saved for offline use/, 20_000);

      // Activate it (reloads the app bound to the inserted pack).
      await page.click('[data-testid="activate-offline-fixture"]');
      await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => undefined);
      await waitForText(page, /Offline Fixture Pack/, 20_000);

      // Sever the network for real — both the app and the pack host.
      await appServer.stop();
      appServer = undefined;
      await packServer.stop();
      packServer = undefined;
      const deadline = Date.now() + 5_000;
      for (const port of [APP_PORT, PACK_PORT]) {
        let reachable = true;
        while (reachable) {
          reachable = await fetch(`http://127.0.0.1:${port}/`).then(
            () => true,
            () => false,
          );
          if (reachable && Date.now() > deadline) {
            throw new Error(`port ${port} still serving after stop()`);
          }
          if (reachable) await new Promise((r) => setTimeout(r, 200));
        }
      }

      // Hard reload offline, navigate into practice, and require the pack
      // image to have actually rendered (decoded pixels, not a broken img).
      await page.reload({ waitUntil: 'networkidle0' }).catch(() => undefined);
      await waitForText(page, /Offline Fixture Pack/, 20_000);
      await page.goto(`${(page.url().split('/').slice(0, 3).join('/'))}/practice/?subject=dots`, {
        waitUntil: 'networkidle0',
      }).catch(() => undefined);
      await waitForText(page, /What shape is shown/, 20_000);
      await page.waitForFunction(
        (port: number) => {
          const img = Array.from(document.images).find((i) =>
            i.src.includes(`127.0.0.1:${port}`),
          );
          return Boolean(img && img.complete && img.naturalWidth > 0);
        },
        { timeout: 20_000, polling: 250 },
        PACK_PORT,
      );
    },
  );
});
