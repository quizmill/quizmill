import { defineConfig } from 'vitest/config';
import path from 'node:path';

const alias = {
  '@': path.resolve(import.meta.dirname, './src'),
};

export default defineConfig({
  test: {
    // Component tests (.test.tsx) render React into a DOM; the rest of
    // the suite is pure logic and stays on the lighter node env. Vitest
    // 3 replaced `environmentMatchGlobs` with per-project configs, so
    // the split lives here as two projects sharing the root config.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          include: ['tests/**/*.test.tsx'],
          environment: 'happy-dom',
        },
      },
    ],
  },
  resolve: { alias },
});
