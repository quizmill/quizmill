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
  status?: 'draft' | 'reviewed' | 'maintained';
  badges?: string[];
  demoUrl?: string;
  questionCount?: number;
}

const registryPath = path.join(__dirname, '..', 'tools', 'pack', 'registry.json');
const { packs } = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
  packs: RegistryEntry[];
};

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
