import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config — drives the static export in `out/` with Playwright,
 * asserting against the committed demo pack. Build first with an empty
 * basePath (http-server serves from the root):
 *
 *   npm run test:e2e        # build + run
 *   npx playwright test     # run against an existing out/
 *
 * Each test gets a fresh browser context, so storage, caches and service
 * workers never leak between tests. The offline specs start (and stop)
 * their own servers on their own ports.
 */
const PORT = 4319;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    // Phone viewport — the app is designed mobile-first.
    viewport: { width: 414, height: 896 },
    trace: 'on-first-retry',
    // E2E_SLOWMO (ms) paces each action when watching with --headed / --ui.
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 0) },
  },
  webServer: {
    command: `npx http-server out -p ${PORT} -s -c-1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !isCI,
    timeout: 15_000,
  },
});
