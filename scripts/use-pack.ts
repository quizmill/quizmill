/**
 * Activate a learning pack: validate it, then copy it into
 * `content/pack/` (gitignored) where the `pack` variant's static
 * imports pick it up at build time.
 *
 *   npm run pack:use packs/my-topic
 *   npm run dev   # then see it live
 *
 * The pack directory itself stays wherever it lives (typically the
 * gitignored `packs/` workspace, or a separate private repo) — this
 * only snapshots it into the build location.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validatePack, type PackManifest } from '../tools/pack/schema';
import { readPackDir } from '../tools/pack/validate';
import { writePackAssets } from './pack-assets';

const TARGET = path.join(__dirname, '..', 'content', 'pack');

function main(): void {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: npm run pack:use <pack-dir>');
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
    console.error('\nPack is invalid — fix the errors above, or run pack:validate.');
    process.exit(1);
  }

  fs.mkdirSync(TARGET, { recursive: true });
  fs.writeFileSync(
    path.join(TARGET, 'pack.json'),
    JSON.stringify(input.manifest, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(TARGET, 'questions.json'),
    JSON.stringify(input.questions, null, 2) + '\n',
  );
  // scenarios.json is imported statically by the variant, so always
  // materialise it — an absent file would break the build.
  fs.writeFileSync(
    path.join(TARGET, 'scenarios.json'),
    JSON.stringify(input.scenarios ?? [], null, 2) + '\n',
  );

  const manifest = input.manifest as PackManifest;
  writePackAssets(manifest);
  const questions = input.questions as unknown[];
  console.log(
    `✓ activated pack "${manifest.title}" (${manifest.id}) — ` +
      `${questions.length} questions, ${manifest.categories.length} categories`,
  );
  console.log('  Run it:  npm run dev');
}

main();
