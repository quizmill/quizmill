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
    // One fork, spec files in sequence: they share the static server
    // from globalSetup and one Chromium at a time keeps CI stable.
    // (Vitest 4 folded `poolOptions.forks.singleFork` into maxWorkers.)
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
