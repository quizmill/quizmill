/**
 * Activate a learning pack: validate it, then copy it into
 * `content/pack/` (gitignored) where the `pack` variant's static
 * imports pick it up at build time.
 *
 *   npm run pack:use packs/my-topic                 # local directory
 *   npm run pack:use quizmill/pack-claude-cert      # GitHub repo
 *   npm run pack:use https://github.com/owner/repo  # ditto
 *   npm run dev   # then see it live
 *
 * The pack source itself stays wherever it lives (a local directory,
 * or a GitHub repo — public or any private one you can `git clone`) —
 * this only snapshots it into the build location, so re-running the
 * command refreshes a remote pack.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validatePack, type PackManifest } from '../tools/pack/schema';
import { readPackDir } from '../tools/pack/validate';
import { writePackAssets } from './pack-assets';
import { fetchRemotePack, parsePackSpec } from './remote-pack';

const TARGET = path.join(__dirname, '..', 'content', 'pack');

function resolveSource(source: string): string {
  if (fs.existsSync(source)) return source;
  const spec = parsePackSpec(source);
  if (!spec) {
    console.error(
      `✗ ${source} is neither a local directory nor a GitHub repo reference (owner/repo)`,
    );
    process.exit(1);
  }
  try {
    return fetchRemotePack(spec);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
}

function main(): void {
  const source = process.argv[2];
  if (!source) {
    console.error('Usage: npm run pack:use <pack-dir | owner/repo | github URL>');
    console.error('       npm run pack:list   # published packs');
    process.exit(1);
  }
  const dir = resolveSource(source);

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
