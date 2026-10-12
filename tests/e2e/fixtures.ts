import fs from 'node:fs';
import path from 'node:path';
import { buildPackBundle } from '../../tools/pack/bundle';

/** Fixture pack options: one category, two or more image-free or imaged questions. */
export interface FixturePack {
  id: string;
  title: string;
  categoryKey: string;
  questionCount: number;
  /** Optional SVG written to assets/ and attached to every question. */
  image?: { name: string; svg: string };
}

/** Write a minimal valid pack directory for the given fixture. */
export function writeFixturePack(dir: string, pack: FixturePack): void {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  if (pack.image) fs.writeFileSync(path.join(dir, 'assets', pack.image.name), pack.image.svg);
  fs.writeFileSync(
    path.join(dir, 'pack.json'),
    JSON.stringify({
      schemaVersion: 2,
      id: pack.id,
      title: pack.title,
      description: `${pack.title} — an E2E fixture.`,
      homeSubtitle: 'E2E fixture.',
      themeColor: '#123456',
      categories: [{ key: pack.categoryKey, label: 'Shapes' }],
    }),
  );
  const questions = Array.from({ length: pack.questionCount }, (_, i) => ({
    id: `${pack.id}-${pack.categoryKey}-00${i + 1}`,
    categoryKey: pack.categoryKey,
    difficulty: 1,
    prompt: 'What shape is shown in the figure above?',
    ...(pack.image ? { image: pack.image.name } : {}),
    options: [
      { key: 'A', text: 'The right one' },
      { key: 'B', text: 'The wrong one' },
    ],
    correctKey: 'A',
    explanation: 'Fixture question — only the flow around it is under test.',
    source: 'original',
    reviewStatus: 'draft',
  }));
  fs.writeFileSync(path.join(dir, 'questions.json'), JSON.stringify(questions));
}

/** Write the fixture pack and bundle it with the real bundler; returns the bundle path. */
export function writeFixtureBundle(workDir: string, pack: FixturePack): string {
  const packDir = path.join(workDir, 'pack');
  writeFixturePack(packDir, pack);
  const built = buildPackBundle(packDir);
  if (!built.ok) throw new Error(built.errors.join('\n'));
  const file = path.join(workDir, `${pack.id}.bundle.json`);
  fs.writeFileSync(file, JSON.stringify(built.bundle));
  return file;
}
