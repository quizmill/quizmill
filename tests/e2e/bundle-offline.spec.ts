import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { writeFixtureBundle } from './fixtures';
import {
  severNetwork,
  startStaticServer,
  waitForPrecache,
  waitForText,
  type Server,
} from './helpers';

/**
 * A pack handed over as ONE bundle file (`quizmill bundle`) carries its
 * images inside as data URLs, so — unlike a pack inserted from a URL —
 * there is no origin to prefetch from and nothing for the service worker
 * to cache: the image is in localStorage with the pack.
 *
 * This test bundles a fixture pack with the real bundler, inserts the
 * file through the /packs file picker, activates it, then stops the app
 * server and proves a question image still renders — straight from the
 * embedded data URL. The server is really stopped for the same reason as
 * offline.spec.ts.
 */
let appServer: Server | undefined;
let workDir: string;
let bundleFile: string;

test.beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizmill-bundle-'));
  bundleFile = writeFixtureBundle(workDir, {
    id: 'bundle-fixture',
    title: 'Bundle Fixture Pack',
    categoryKey: 'shapes',
    questionCount: 2,
    image: {
      name: 'square.svg',
      svg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
        '<rect width="40" height="40" fill="#fffdf6"/><rect x="8" y="8" width="24" height="24" fill="#26221b"/></svg>',
    },
  });
});

test.afterAll(async () => {
  await appServer?.stop();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test('a pack inserted from a bundle file shows its images with the network gone', async ({ page }) => {
  test.setTimeout(90_000);
  appServer = await startStaticServer();

  // Install the SW and wait for the precache, as offline.spec.ts does.
  await page.goto(`${appServer.url}/`, { waitUntil: 'networkidle' });
  await waitForPrecache(page);

  // Insert the bundle through the file picker on /packs.
  await page.goto(`${appServer.url}/packs/`, { waitUntil: 'networkidle' });
  await page.locator('input[data-testid="insert-files"]').setInputFiles(bundleFile);
  const result = page.locator('[data-testid="insert-result"]');
  await expect(result).toContainText(/Inserted “Bundle Fixture Pack”/, { timeout: 20_000 });
  // Nothing to prefetch — the images are inside the pack, so the
  // "saved for offline use" suffix must NOT appear.
  await expect(result).not.toContainText(/saved for offline use/);

  // Activate it (reloads the app bound to the inserted pack).
  await Promise.all([
    page.waitForEvent('load'),
    page.click('[data-testid="activate-bundle-fixture"]'),
  ]);
  await waitForText(page, /Bundle Fixture Pack/, 20_000);

  await severNetwork(appServer);

  // Hard reload offline, navigate into practice, and require the pack
  // image to have rendered from its embedded data URL.
  await page.reload();
  await waitForText(page, /Bundle Fixture Pack/, 20_000);
  await page.goto(`${appServer.url}/practice/?subject=shapes`);
  await waitForText(page, /What shape is shown/, 20_000);
  await page.waitForFunction(
    () => {
      const img = Array.from(document.images).find((i) =>
        i.src.startsWith('data:image/svg+xml;base64,'),
      );
      return Boolean(img && img.complete && img.naturalWidth > 0);
    },
    undefined,
    { timeout: 20_000, polling: 250 },
  );
});
