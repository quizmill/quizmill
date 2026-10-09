import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { buildPackBundle } from '../../tools/pack/bundle';
import {
  launchBrowser,
  newPage,
  startStaticServer,
  waitForText,
  type Server,
} from '../e2e/helpers';

/**
 * A pack handed over as ONE bundle file (`quizmill bundle`) carries its
 * images inside as data URLs, so — unlike a pack inserted from a URL —
 * there is no origin to prefetch from and nothing for the service worker
 * to cache: the image is in localStorage with the pack.
 *
 * This test bundles a fixture pack with the real bundler, inserts the
 * file through the /packs file picker, activates it, then stops the app
 * server and proves a question image still renders — straight from the
 * embedded data URL. The server is really stopped rather than
 * CDP-offline-emulated for the same reason as offline.spec.ts.
 */
const APP_PORT = 4334;

let browser: Browser;
let page: Page;
let appServer: Server | undefined;
let workDir: string;
let bundleFile: string;

/** A minimal visual pack: one category, every question carries an image. */
function writeFixturePack(dir: string): void {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
    '<rect width="40" height="40" fill="#fffdf6"/><rect x="8" y="8" width="24" height="24" fill="#26221b"/></svg>';
  fs.writeFileSync(path.join(dir, 'assets', 'square.svg'), svg);
  fs.writeFileSync(
    path.join(dir, 'pack.json'),
    JSON.stringify({
      schemaVersion: 2,
      id: 'bundle-fixture',
      title: 'Bundle Fixture Pack',
      description: 'Fixture pack proving a bundled pack renders its images offline.',
      homeSubtitle: 'Bundled images fixture.',
      themeColor: '#123456',
      categories: [{ key: 'shapes', label: 'Shapes' }],
    }),
  );
  const question = (n: number) => ({
    id: `bundle-fixture-shapes-00${n}`,
    categoryKey: 'shapes',
    difficulty: 1,
    prompt: 'What shape is shown in the figure above?',
    image: 'square.svg',
    options: [
      { key: 'A', text: 'A square' },
      { key: 'B', text: 'A circle' },
    ],
    correctKey: 'A',
    explanation:
      'The figure shows a filled square — this fixture only checks that the bundled image renders offline.',
    source: 'original',
    reviewStatus: 'draft',
  });
  fs.writeFileSync(
    path.join(dir, 'questions.json'),
    JSON.stringify([question(1), question(2)]),
  );
}

beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizmill-bundle-'));
  const packDir = path.join(workDir, 'pack');
  writeFixturePack(packDir);
  const built = buildPackBundle(packDir);
  if (!built.ok) throw new Error(built.errors.join('\n'));
  bundleFile = path.join(workDir, 'bundle-fixture.bundle.json');
  fs.writeFileSync(bundleFile, JSON.stringify(built.bundle));
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
  if (appServer) await appServer.stop();
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('bundled pack images offline', () => {
  it(
    'a pack inserted from a bundle file shows its images with the network gone',
    { timeout: 90_000 },
    async () => {
      appServer = await startStaticServer(APP_PORT);
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

      // Insert the bundle through the file picker on /packs.
      await page.goto(`${appServer.url}/packs/`, { waitUntil: 'networkidle0' });
      const picker = await page.$('input[data-testid="insert-files"]');
      expect(picker, 'the file input on /packs').toBeTruthy();
      await picker!.uploadFile(bundleFile);
      await waitForText(page, /Inserted “Bundle Fixture Pack”/, 20_000);
      // Nothing to prefetch — the images are inside the pack, so the
      // "saved for offline use" suffix must NOT appear.
      const message = await page.$eval(
        '[data-testid="packs-message"]',
        (el) => el.textContent ?? '',
      );
      expect(message).not.toMatch(/saved for offline use/);

      // Activate it (reloads the app bound to the inserted pack).
      await page.click('[data-testid="activate-bundle-fixture"]');
      await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => undefined);
      await waitForText(page, /Bundle Fixture Pack/, 20_000);

      // Sever the network for real.
      await appServer.stop();
      appServer = undefined;
      const deadline = Date.now() + 5_000;
      let reachable = true;
      while (reachable) {
        reachable = await fetch(`http://127.0.0.1:${APP_PORT}/`).then(
          () => true,
          () => false,
        );
        if (reachable && Date.now() > deadline) {
          throw new Error(`port ${APP_PORT} still serving after stop()`);
        }
        if (reachable) await new Promise((r) => setTimeout(r, 200));
      }

      // Hard reload offline, navigate into practice, and require the pack
      // image to have rendered from its embedded data URL.
      await page.reload({ waitUntil: 'networkidle0' }).catch(() => undefined);
      await waitForText(page, /Bundle Fixture Pack/, 20_000);
      await page
        .goto(`${page.url().split('/').slice(0, 3).join('/')}/practice/?subject=shapes`, {
          waitUntil: 'networkidle0',
        })
        .catch(() => undefined);
      await waitForText(page, /What shape is shown/, 20_000);
      await page.waitForFunction(
        () => {
          const img = Array.from(document.images).find((i) =>
            i.src.startsWith('data:image/svg+xml;base64,'),
          );
          return Boolean(img && img.complete && img.naturalWidth > 0);
        },
        { timeout: 20_000, polling: 250 },
      );
    },
  );
});
