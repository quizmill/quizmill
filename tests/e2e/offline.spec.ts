import { test } from '@playwright/test';
import {
  severNetwork,
  startStaticServer,
  waitForPrecache,
  waitForText,
  type Server,
} from './helpers';

/**
 * Offline regression suite. The bug: with the app "installed" (SW active),
 * Home loads offline but tapping a category dead-ends — the practice
 * route's chunks/RSC payloads were only cached if that route had been
 * visited online, and client-nav fetches carry a `?_rsc=` cache-buster
 * (and navigations carry `?subject=`) that never match the cache.
 *
 * Runs against its own static server (not the shared webServer) so the
 * test can STOP the server to sever the network for real — offline
 * emulation doesn't reliably cover service-worker fetches.
 */
let server: Server | undefined;

test.afterAll(async () => {
  await server?.stop();
});

test('category click and hard reload work with the network gone', async ({ page }) => {
  test.setTimeout(90_000);
  server = await startStaticServer();
  await page.goto(`${server.url}/`, { waitUntil: 'networkidle' });
  await waitForPrecache(page);

  await severNetwork(server);

  // Client-side navigation: tap the first category card (the mode cards
  // above it — the timed exam's — link under /practice/ too).
  await page.locator('a[href*="/practice/?subject="]').first().click();
  await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

  // Hard navigation with a query string (?subject=...) must also hit
  // the cached route shell.
  await page.goto(`${server.url}/practice/?subject=planets`);
  await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);
});
