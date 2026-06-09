import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * E2E config — drives the static export in `out/` with Puppeteer,
 * asserting against the committed demo pack.
 *
 * Usage:  npm run test:e2e
 */
export default defineConfig({
  test: {
    include: ['tests/e2e-pack/**/*.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globalSetup: ['./tests/e2e-pack/setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
