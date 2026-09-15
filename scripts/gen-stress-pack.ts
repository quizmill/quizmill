/**
 * Generate a large, schema-valid "stress test" pack into
 * `content/pack-stress/` (gitignored) — a synthetic bank big enough to
 * make size-dependent behaviour observable: the inlined pack JSON, the
 * per-category selection pass, list rendering, storage/stats growth, and
 * the tap → quiz transition. Real packs run from 40 to ~700 questions, so
 * this is the only way to see what a multi-thousand-question pack does
 * without authoring one.
 *
 * Deterministic (seeded RNG), so repeated runs produce a byte-identical
 * pack and two profiling runs are comparable.
 *
 *   npm run pack:stress            # generate 2000 questions + activate
 *   STRESS_COUNT=5000 npm run pack:stress
 *
 * It is a throwaway local aid, never published: the pack lands in a
 * gitignored directory, and `npm run pack:use <real pack>` (or
 * `rm -rf content/pack` + any npm script) puts the demo pack back.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'content', 'pack-stress');

const COUNT = Math.max(
  100,
  Number.parseInt(process.env.STRESS_COUNT ?? '', 10) || 2000,
);

/** Small deterministic PRNG (mulberry32) so the pack is reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(0x9e3779b9);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

const CATEGORIES: { key: string; label: string; shortLabel?: string }[] = [
  { key: 'mechanics', label: 'Mechanics', shortLabel: 'Mech' },
  { key: 'thermodynamics', label: 'Thermodynamics', shortLabel: 'Thermo' },
  { key: 'electromagnetism', label: 'Electromagnetism', shortLabel: 'E&M' },
  { key: 'optics', label: 'Optics' },
  { key: 'quantum', label: 'Quantum' },
  { key: 'astrophysics', label: 'Astrophysics', shortLabel: 'Astro' },
];

const LEVELS = [
  { key: 'foundation', label: 'Foundation' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
] as const;

const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;

const SUBJECTS = [
  'a frictionless pulley system',
  'an ideal gas undergoing isothermal expansion',
  'a charged particle in a uniform magnetic field',
  'a thin converging lens',
  'an electron confined to a one-dimensional box',
  'a binary star system',
  'a damped harmonic oscillator',
  'a parallel-plate capacitor',
  'a blackbody radiator',
  'a relativistic muon',
];

const ATTRIBUTES = [
  'its total mechanical energy',
  'the net flux through the surface',
  'the magnitude of the induced current',
  'the resulting angular momentum',
  'the equilibrium temperature',
  'the de Broglie wavelength',
  'the radius of the orbit',
  'the time constant of the decay',
];

const manifest = {
  schemaVersion: 2 as const,
  id: 'stress-test',
  title: 'Stress Test Pack',
  description:
    'A large synthetic pack used to make quiz loading states visible in review. Not real physics — do not learn from it.',
  homeSubtitle: 'Synthetic pack for exercising loading feedback.',
  themeColor: '#1e3a5f',
  categories: CATEGORIES.map((c, i) => ({
    key: c.key,
    label: c.label,
    ...(c.shortLabel ? { shortLabel: c.shortLabel } : {}),
    // Round-ish weights summing to ~1 so the readiness/blueprint paths
    // exercise too; exact sum isn't required (only warned on).
    weight: Number((1 / CATEGORIES.length).toFixed(3)) + (i === 0 ? 0.002 : 0),
  })),
  levels: LEVELS.map((l) => ({ key: l.key, label: l.label })),
  levelsLabel: 'Tier',
} as const;

function makeQuestion(i: number) {
  const category = CATEGORIES[i % CATEGORIES.length];
  const level = LEVELS[i % LEVELS.length];
  const subject = pick(SUBJECTS);
  const attribute = pick(ATTRIBUTES);
  const correctKey = pick(OPTION_KEYS);
  const id = `q-${String(i + 1).padStart(5, '0')}`;
  const factor = 1 + (i % 9);

  const options = OPTION_KEYS.map((key) => ({
    key,
    text:
      key === correctKey
        ? `It scales linearly with the applied factor (×${factor}).`
        : `It is unaffected — option ${key} is a deliberate distractor.`,
  }));

  return {
    id,
    categoryKey: category.key,
    level: level.key,
    difficulty: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
    prompt: `Q${i + 1}. Consider ${subject}. Which statement best describes ${attribute} when the controlling parameter is increased by a factor of ${factor}?`,
    options,
    correctKey,
    explanation: `For ${subject}, ${attribute} responds to the controlling parameter according to its governing relation. Increasing the parameter by ${factor}× rescales the quantity proportionally, so option ${correctKey} is correct; the distractors invert or ignore that dependence. (Synthetic explanation generated for load testing.)`,
    source: 'generated' as const,
    reviewStatus: 'draft' as const,
    tags: [category.key, level.key, `factor-${factor}`],
  };
}

function main(): void {
  const questions = Array.from({ length: COUNT }, (_, i) => makeQuestion(i));

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'pack.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(OUT, 'questions.json'),
    JSON.stringify(questions, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(OUT, 'scenarios.json'), '[]\n');
  fs.writeFileSync(path.join(OUT, 'concepts.json'), '[]\n');

  const bytes = fs.statSync(path.join(OUT, 'questions.json')).size;
  console.log(
    `[gen-stress-pack] wrote ${questions.length} questions ` +
      `(${(bytes / 1024).toFixed(0)} KB) to content/pack-stress/`,
  );
  console.log('  Activate it:  npm run pack:use content/pack-stress');
}

main();
