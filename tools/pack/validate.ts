/**
 * Learning-pack validator CLI.
 *
 *   npm run pack:validate <pack-dir>
 *   npx tsx tools/pack/validate.ts packs/my-topic
 *
 * Exit 0 when the pack is valid (warnings allowed), 1 otherwise.
 * Agents authoring packs should loop on this until it passes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validatePack } from './schema';

export function readPackDir(dir: string): {
  manifest: unknown;
  questions: unknown;
  scenarios?: unknown;
  concepts?: unknown;
} {
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

  let input: ReturnType<typeof readPackDir>;
  try {
    input = readPackDir(dir);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  const result = validatePack(input);
  for (const w of result.warnings) console.warn(`⚠ ${w}`);
  if (!result.ok) {
    for (const e of result.errors) console.error(`✗ ${e}`);
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
