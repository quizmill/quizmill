import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * The sync worker (cloudflare/) is deployed by hand with `wrangler deploy`,
 * so nothing in CI would notice if its entry stopped bundling. Since it
 * started importing engine source (src/lib/syncKey.ts) that risk is real:
 * a stray `window`, `localStorage` or Node import in a shared module
 * would only surface at deploy time. This bundles the worker the way
 * wrangler does underneath (esbuild, ESM, workerd conditions) and pins
 * what may end up inside it.
 */

const ROOT = path.resolve(import.meta.dirname, '..');

/** Engine modules the deployed worker is allowed to pull in. */
const ENGINE_MODULES_IN_WORKER = ['src/lib/syncKey.ts'];

async function bundleWorker() {
  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: ['cloudflare/src/worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    conditions: ['workerd', 'worker', 'browser'],
    metafile: true,
    logLevel: 'silent',
  });
  return { code: result.outputFiles[0].text, inputs: Object.keys(result.metafile.inputs).sort() };
}

describe('sync worker bundle', () => {
  it('bundles for workerd from worker sources plus the allowed engine modules only', async () => {
    const { inputs } = await bundleWorker();
    const outsideWorker = inputs.filter((file) => !file.startsWith('cloudflare/src/'));
    expect(outsideWorker).toEqual(ENGINE_MODULES_IN_WORKER);
    expect(inputs.some((file) => file.includes('node_modules'))).toBe(false);
  });

  it('references no browser or Node globals', async () => {
    const { code } = await bundleWorker();
    for (const global of ['require', 'process', 'window', 'document', 'localStorage', 'navigator']) {
      expect(code, `bundle references \`${global}\``).not.toMatch(new RegExp(`\\b${global}\\b`));
    }
  });

  it('tree-shakes syncKey down to the name canonicaliser', async () => {
    const { code } = await bundleWorker();
    expect(code).toContain('normalizeKeyName');
    expect(code).not.toContain('generateSyncKey');
    expect(code).not.toContain('mailto:');
  });
});
