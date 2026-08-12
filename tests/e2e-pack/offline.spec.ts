import { afterAll, beforeAll, describe, it } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import {
  launchBrowser,
  newPage,
  startStaticServer,
  waitForText,
  type Server,
} from '../e2e/helpers';

/**
 * Offline regression suite. The bug: with the app "installed" (SW active),
 * Home loads offline but tapping a category dead-ends — the practice
 * route's chunks/RSC payloads were only cached if that route had been
 * visited online, and client-nav fetches carry a `?_rsc=` cache-buster
 * (and navigations carry `?subject=`) that never match the cache.
 *
 * Runs against its own static server (not the shared globalSetup one) so
 * the test can STOP the server to sever the network for real — CDP
 * offline emulation doesn't apply to service-worker fetches, so
 * `page.setOfflineMode(true)` would let the SW quietly keep fetching.
 */
const PORT = 4331;

let browser: Browser;
let page: Page;
let server: Server | undefined;

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
  if (server) await server.stop();
});

describe('offline practice', () => {
  it(
    'category click and hard reload work with the network gone',
    { timeout: 90_000 },
    async () => {
      server = await startStaticServer(PORT);
      page = await newPage(browser);
      await page.goto(`${server.url}/`, { waitUntil: 'networkidle0' });

      // Wait until the SW controls the page AND has precached the practice
      // route — it must be reachable offline without ever visiting it online.
      await page.waitForFunction(
        async () => {
          if (!navigator.serviceWorker?.controller) return false;
          const hit = await caches.match('/practice/', { ignoreSearch: true });
          return Boolean(hit);
        },
        { timeout: 30_000, polling: 500 },
      );

      // Sever the network for real, and prove it: if the origin still
      // answers (e.g. a stale server squatting on the port), "offline"
      // would silently test nothing.
      await server.stop();
      server = undefined;
      const deadline = Date.now() + 5_000;
      let reachable = true;
      while (reachable) {
        reachable = await fetch(`http://127.0.0.1:${PORT}/`).then(
          () => true,
          () => false, // connection refused — actually offline now
        );
        if (reachable && Date.now() > deadline) {
          throw new Error(
            `port ${PORT} still serving after stop() — stale http-server?`,
          );
        }
        if (reachable) await new Promise((r) => setTimeout(r, 200));
      }

      // Client-side navigation: tap the first category card.
      await page.click('a[href*="/practice/"]');
      await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

      // Hard navigation with a query string (?subject=...) must also hit
      // the cached route shell.
      await page.goto(`http://127.0.0.1:${PORT}/practice/?subject=planets`, {
        waitUntil: 'load',
      });
      await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);
    },
  );
});
