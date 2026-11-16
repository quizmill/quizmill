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

interface RegistryEntry {
  id: string;
  title: string;
  description: string;
  repo: string;
  /** Directory inside `repo`, when the repo holds several packs. */
  path?: string;
}

const registryPath = path.join(__dirname, '..', 'tools', 'pack', 'registry.json');
const { packs } = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
  packs: RegistryEntry[];
};

console.log('Published learning packs:\n');
for (const pack of packs) {
  console.log(`  ${pack.title} (${pack.id})`);
  console.log(`    ${pack.description}`);
  const link = `https://github.com/${pack.repo}`;
  console.log(`    ${pack.path ? `${link}/tree/HEAD/${pack.path}` : link}`);
  console.log(`    install: npm run pack:use ${pack.repo}${pack.path ? `/${pack.path}` : ''}\n`);
}
console.log(
  'Any GitHub repo containing a valid pack installs the same way —\n' +
    'private repos too, as long as `git clone` works for your account.',
);
