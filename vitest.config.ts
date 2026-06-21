import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // Component tests (.test.tsx) render React into a DOM; the rest of
    // the suite is pure logic and stays on the lighter node env.
    environmentMatchGlobs: [['tests/**/*.test.tsx', 'happy-dom']],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
