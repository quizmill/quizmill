import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';
import { writeFixturePack } from './fixtures';
import {
  severNetwork,
  startStaticServer,
  waitForPrecache,
  waitForText,
  type Server,
} from './helpers';

/**
 * Offline images for RUNTIME-INSERTED packs. The pack's JSON lives in
 * localStorage, but its images live on the pack's origin — so at insert
 * time they are prefetched into the deploy-independent PACK_ASSETS_CACHE
 * (src/lib/packAssets.ts) and the service worker serves them from it.
 *
 * This test inserts a fixture pack from a second local server (a plain
 * static host — deliberately NOT GitHub), then stops BOTH servers and
 * proves a question image still renders. Real servers are stopped for the
 * same reason as offline.spec.ts.
 */
let appServer: Server | undefined;
let packServer: Server | undefined;
let packDir: string;

test.beforeAll(() => {
  packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizmill-offline-pack-'));
  writeFixturePack(packDir, {
    id: 'offline-fixture',
    title: 'Offline Fixture Pack',
    categoryKey: 'dots',
    questionCount: 2,
    image: {
      name: 'dot.svg',
      svg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
        '<rect width="40" height="40" fill="#fffdf6"/><circle cx="20" cy="20" r="12" fill="#26221b"/></svg>',
    },
  });
});

test.afterAll(async () => {
  await appServer?.stop();
  await packServer?.stop();
  fs.rmSync(packDir, { recursive: true, force: true });
});

test('inserted pack still shows its question images with the network gone', async ({ page }) => {
  test.setTimeout(90_000);
  appServer = await startStaticServer();
  packServer = await startStaticServer({ dir: packDir, cors: true });

  // Install the SW and wait for the precache, as offline.spec.ts does.
  await page.goto(`${appServer.url}/`, { waitUntil: 'networkidle' });
  await waitForPrecache(page);

  // Insert the pack by URL on /packs and wait for the offline-prefetch
  // confirmation ("1 of 1 images saved for offline use" — the two
  // questions share one image).
  await page.goto(`${appServer.url}/packs/`, { waitUntil: 'networkidle' });
  await page.locator('input[placeholder*="github.com"]').fill(packServer.url);
  await page.getByRole('button', { name: 'Fetch', exact: true }).click();
  await waitForText(page, /images saved for offline use/, 20_000);

  // Activate it (reloads the app bound to the inserted pack).
  await Promise.all([
    page.waitForEvent('load'),
    page.click('[data-testid="activate-offline-fixture"]'),
  ]);
  await waitForText(page, /Offline Fixture Pack/, 20_000);

  // Sever the network for real — both the app and the pack host.
  await severNetwork(appServer, packServer);

  // Hard reload offline, navigate into practice, and require the pack
  // image to have actually rendered (decoded pixels, not a broken img).
  await page.reload();
  await waitForText(page, /Offline Fixture Pack/, 20_000);
  await page.goto(`${appServer.url}/practice/?subject=dots`);
  await waitForText(page, /What shape is shown/, 20_000);
  await page.waitForFunction(
    (origin) => {
      const img = Array.from(document.images).find((i) => i.src.startsWith(origin));
      return Boolean(img && img.complete && img.naturalWidth > 0);
    },
    packServer.url,
    { timeout: 20_000, polling: 250 },
  );
});
