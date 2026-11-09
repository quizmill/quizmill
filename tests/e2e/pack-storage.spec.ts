import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { writeFixtureBundle } from './fixtures';
import { waitForText } from './helpers';

/**
 * Inserted packs live in IndexedDB, not localStorage (src/lib/packStore.ts).
 * localStorage is ~5 MB per origin, counted in UTF-16, and shared with all
 * progress — a phone holding two big packs refused a third with "not
 * enough storage space". Three ~2.5 MB packs together are more than this
 * browser's localStorage holds (checked at the end); all three must go in,
 * and only the ACTIVE one is copied to localStorage for the boot.
 */
const PACKS = ['big-pack-a', 'big-pack-b', 'big-pack-c'];
const PACK_KEY_PREFIX = 'quizmill.packLibrary.pack.';
let workDir: string;
const files: Record<string, string> = {};

test.beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quizmill-pack-storage-'));
  for (const id of PACKS) {
    const dir = path.join(workDir, id);
    fs.mkdirSync(dir);
    const file = writeFixtureBundle(dir, {
      id,
      title: `Big Pack ${id.slice(-1).toUpperCase()}`,
      categoryKey: 'shapes',
      questionCount: 5,
    });
    // Pad each explanation so the bundle weighs ~2.5 MB of JSON.
    const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const q of bundle.questions) q.explanation += ' ' + 'x'.repeat(500 * 1024);
    fs.writeFileSync(file, JSON.stringify(bundle));
    files[id] = file;
  }
});

test.afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

test('three big packs fit on one device; only the active one is copied to localStorage', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/packs/', { waitUntil: 'networkidle' });
  await waitForText(page, 'Insert a pack');

  const result = page.locator('[data-testid="insert-result"]');
  for (const id of PACKS) {
    await page.locator('input[data-testid="insert-files"]').setInputFiles(files[id]);
    await expect(result).toContainText(`Inserted “Big Pack ${id.slice(-1).toUpperCase()}”`, {
      timeout: 30_000,
    });
    await expect(page.locator(`[data-testid="pack-card-${id}"]`)).toHaveCount(1);
  }
  const packKeys = () =>
    page.evaluate(
      (prefix) => Object.keys(localStorage).filter((k) => k.startsWith(prefix)),
      PACK_KEY_PREFIX,
    );
  expect(await packKeys()).toEqual([]);

  // Make the last one active: it — and only it — is mirrored for the boot.
  await Promise.all([page.waitForEvent('load'), page.click('[data-testid="insert-result-activate"]')]);
  await expect(page.locator('[data-testid="pack-card-big-pack-c"]')).toContainText('Active', {
    timeout: 20_000,
  });
  expect(await packKeys()).toEqual([`${PACK_KEY_PREFIX}big-pack-c.v1`]);

  // Switch to another inserted pack from the shelf: the mirror moves.
  await Promise.all([
    page.waitForEvent('load'),
    page.click('[data-testid="activate-big-pack-a"]'),
  ]);
  await expect(page.locator('[data-testid="pack-card-big-pack-a"]')).toContainText('Active', {
    timeout: 20_000,
  });
  expect(await packKeys()).toEqual([`${PACK_KEY_PREFIX}big-pack-a.v1`]);

  // The scenario is real here: the same three packs do NOT fit in
  // localStorage side by side.
  const sizes = PACKS.map((id) => fs.statSync(files[id]).size);
  const overflowed = await page.evaluate((lengths) => {
    try {
      lengths.forEach((n, i) => localStorage.setItem(`scratch.${i}`, 'x'.repeat(n)));
      return false;
    } catch (e) {
      return (e as DOMException).name;
    } finally {
      lengths.forEach((_, i) => localStorage.removeItem(`scratch.${i}`));
    }
  }, sizes);
  expect(overflowed).toBe('QuotaExceededError');
});
