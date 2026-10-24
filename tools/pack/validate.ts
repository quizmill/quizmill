/**
 * Learning-pack validator CLI.
 *
 *   npm run pack:validate <pack-dir>
 *   npx tsx tools/pack/validate.ts packs/my-topic
 *
 * Exit 0 when the pack is valid (warnings allowed), 1 otherwise.
 * Agents authoring packs should loop on this until it passes.
 *
 * Checks the per-file Zod schemas (manifest incl. the optional `exam`,
 * `games`, `progression` and `upgrade` blocks — an `upgrade.url` must be
 * https), then the cross-file references: unique ids, category / scenario
 * / concept / level / paper keys, image paths, category weights. Finally, with the
 * directory in hand, it warns about every referenced image that isn't a
 * file under `<pack-dir>/assets/` — `validatePack` can't (it also runs in
 * the browser on insert), and without this the author only finds out from
 * a broken figure in the app or a refused bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  validatePack,
  type PackFiles,
  type PackQuestion,
  type PackValidationResult,
} from './schema';

export function readPackDir(dir: string): PackFiles {
  const readJson = (name: string, optional = false): unknown => {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) {
      if (optional) return undefined;
      throw new Error(`missing required file: ${p}`);
    }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  };
  return {
    manifest: readJson('pack.json'),
    questions: readJson('questions.json'),
    scenarios: readJson('scenarios.json', true),
    concepts: readJson('concepts.json', true),
  };
}

/** Every relative image path the bank references, deduped in first-seen
 *  order (absolute URLs — not valid in a pack anyway — are left alone). */
export function referencedImages(questions: PackQuestion[]): string[] {
  const seen = new Set<string>();
  const add = (src: string | undefined) => {
    if (src && !/^https?:\/\//i.test(src)) seen.add(src);
  };
  for (const q of questions) {
    add(q.image);
    for (const o of q.options) add(o.image);
  }
  return [...seen];
}

/** The referenced images that are NOT a file under `<dir>/assets/`, in
 *  reference order — what the app would render as a broken figure. Call
 *  after `validatePack` passed, so the questions are well-typed. */
export function missingPackAssets(dir: string, questions: PackQuestion[]): string[] {
  const assetsDir = path.join(dir, 'assets');
  return referencedImages(questions).filter((rel) => {
    const file = path.join(assetsDir, rel);
    return !fs.existsSync(file) || !fs.statSync(file).isFile();
  });
}

/** `readPackDir` for a CLI: a missing or unparseable file prints ✗ and
 *  exits 1 instead of throwing. */
export function readPackDirOrExit(dir: string): PackFiles {
  try {
    return readPackDir(dir);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
}

/** Print a validation result the way every pack command does — warnings
 *  as ⚠, then errors as ✗ — and return whether the pack passed. The
 *  caller adds its own closing line and exits. */
export function printValidation(result: PackValidationResult): boolean {
  for (const w of result.warnings) console.warn(`⚠ ${w}`);
  for (const e of result.errors) console.error(`✗ ${e}`);
  return result.ok;
}

function main(): void {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: npm run pack:validate <pack-dir>');
    process.exit(1);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`Not a directory: ${dir}`);
    process.exit(1);
  }

  const input = readPackDirOrExit(dir);
  const pure = validatePack(input);
  // A referenced image that isn't in assets/ is a warning for now, so a
  // pack that validated clean before keeps exiting 0; it becomes an error
  // once the published packs are known clean. Only a pack that passed the
  // pure checks has well-typed questions to walk.
  const missing = pure.ok
    ? missingPackAssets(dir, input.questions as PackQuestion[]).map(
        (rel) => `assets/${rel}: referenced by a question but not found in ${dir}`,
      )
    : [];
  const result = { ...pure, warnings: [...pure.warnings, ...missing] };
  if (!printValidation(result)) {
    console.error(`\n${result.errors.length} error(s) in ${dir}`);
    process.exit(1);
  }

  const questions = input.questions as unknown[];
  console.log(
    `✓ valid pack at ${dir} — ${questions.length} questions` +
      (result.warnings.length ? ` (${result.warnings.length} warning(s))` : ''),
  );
}

// use-pack.ts imports readPackDir from this module — only behave as a
// CLI when invoked directly.
if (require.main === module) main();
