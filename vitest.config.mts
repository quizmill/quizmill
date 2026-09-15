import { defineConfig } from 'vitest/config';
import path from 'node:path';

const alias = { '@': path.resolve(import.meta.dirname, './src') };

export default defineConfig({
  resolve: { alias },
  test: {
    // Two projects rather than one suite: component tests (.test.tsx)
    // render React into a DOM, the rest of the suite is pure logic and
    // stays on the lighter node env. (Replaces environmentMatchGlobs,
    // which vitest 3 removed.)
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'dom',
          include: ['tests/**/*.test.tsx'],
          environment: 'happy-dom',
        },
      },
    ],
  },
});
