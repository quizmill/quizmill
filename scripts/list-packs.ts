/**
 * List the published learning packs from tools/pack/registry.json.
 *
 *   npm run pack:list
 *
 * The registry only lists public packs; any GitHub repo you can clone
 * (including private ones) installs the same way.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateRegistry, type RegistryEntry } from '../tools/pack/registrySchema';

const registryPath = path.join(__dirname, '..', 'tools', 'pack', 'registry.json');

// Validate before listing: the registry is hand-edited by PR, and the
// failure mode that git cannot catch is two branches each appending an
// entry for the SAME pack. Fail loudly here rather than list it twice.
let packs: RegistryEntry[];
try {
  packs = validateRegistry(JSON.parse(fs.readFileSync(registryPath, 'utf8')));
} catch (err) {
  console.error(`${(err as Error).message}\n`);
  process.exit(1);
}

console.log('Published learning packs:\n');
for (const pack of packs) {
  console.log(`  ${pack.title} (${pack.id})`);
  console.log(`    ${pack.description}`);
  const meta = [
    pack.status ? `status: ${pack.status}` : null,
    pack.questionCount ? `${pack.questionCount} questions` : null,
    pack.badges?.length ? `badges: ${pack.badges.join(', ')}` : null,
  ].filter(Boolean);
  if (meta.length) console.log(`    ${meta.join(' · ')}`);
  console.log(`    repo: https://github.com/${pack.repo}`);
  if (pack.demoUrl) console.log(`    demo: ${pack.demoUrl}`);
  console.log(`    install: npm run pack:use ${pack.repo}\n`);
}
console.log(
  'Any GitHub repo containing a valid pack installs the same way —\n' +
    'private repos too, as long as `git clone` works for your account.',
);
