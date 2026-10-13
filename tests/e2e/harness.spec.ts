import { expect, test } from '@playwright/test';
import { waitForPrecache } from './helpers';

/**
 * Self-checks for the E2E harness. The offline suites rely on these
 * helpers to gate the moment the network is severed; a helper that
 * resolves early makes the suite flake instead of guarding the feature.
 */
test.describe('waitForPrecache', () => {
  // No service worker can register in this context, so nothing is ever
  // precached and the helper must keep waiting (and time out), not return.
  test.use({ serviceWorkers: 'block' });

  test('does not resolve before a service worker controls the page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(waitForPrecache(page, 2_000)).rejects.toThrow(/precache not ready/);
  });
});
