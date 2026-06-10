#!/usr/bin/env node
/**
 * quizmill CLI — run the practice-app engine without cloning it.
 *
 * Keeps an engine checkout in ~/.quizmill/engine (override with
 * QUIZMILL_ENGINE for development) and shells out to its npm scripts,
 * so the CLI stays a thin, dependency-free wrapper and the engine
 * remains the single source of truth.
 *
 *   npx quizmill new my-topic        scaffold a pack to edit (or hand to your agent)
 *   npx quizmill validate my-topic   schema + cross-reference checks
 *   npx quizmill run my-topic        activate a pack and start the app
 *   npx quizmill run owner/repo      ...straight from a GitHub pack repo
 *   npx quizmill build my-topic      static site in <pack-id>-app/
 *   npx quizmill list                published packs
 *   npx quizmill upgrade             update the cached engine
 */
const { execSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ENGINE_REPO = 'https://github.com/quizmill/quizmill.git';
const HOME = process.env.QUIZMILL_HOME || path.join(os.homedir(), '.quizmill');
const ENGINE = process.env.QUIZMILL_ENGINE || path.join(HOME, 'engine');
const CLI_VERSION = require('../package.json').version;

const log = (s) => console.log(s);
const die = (s) => {
  console.error(`✗ ${s}`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function ensureEngine() {
  if (!fs.existsSync(path.join(ENGINE, 'package.json'))) {
    log(`… first run: fetching the quizmill engine into ${ENGINE}`);
    fs.mkdirSync(path.dirname(ENGINE), { recursive: true });
    run('git', ['clone', '--depth', '1', ENGINE_REPO, ENGINE]);
  }
  if (!fs.existsSync(path.join(ENGINE, 'node_modules'))) {
    log('… installing engine dependencies (first run only)');
    run('npm', ['install', '--no-fund', '--no-audit'], { cwd: ENGINE });
  }
}

function engineNpm(args) {
  ensureEngine();
  const env = { ...process.env };
  // The cached engine is a shallow, tagless clone, so its own
  // `git describe` can't resolve a release tag — the in-app version would
  // fall back to the 0.0.0-dev sentinel. Stamp the build with the CLI's
  // version instead (the CLI is published in lockstep with the engine).
  // Skipped when QUIZMILL_ENGINE points at a real checkout (let its git
  // tags win) or when the caller set the version explicitly.
  if (!process.env.QUIZMILL_ENGINE && !env.NEXT_PUBLIC_APP_VERSION) {
    env.NEXT_PUBLIC_APP_VERSION = CLI_VERSION;
  }
  run('npm', args, { cwd: ENGINE, env });
}

/** Resolve a pack argument: absolute path for dirs, verbatim otherwise
 *  (the engine handles owner/repo and URLs itself). */
function packSource(arg) {
  if (!arg) return null;
  return fs.existsSync(arg) ? path.resolve(arg) : arg;
}

const TEMPLATE_MANIFEST = (id) => ({
  schemaVersion: 1,
  id,
  title: 'My Topic Practice',
  description: 'Multiple-choice practice on my topic. Edit me.',
  homeSubtitle: 'Keep the wheel turning.',
  themeColor: '#0f766e',
  categories: [{ key: 'basics', label: 'Basics' }],
});

const TEMPLATE_QUESTION = (id) => ({
  id: `${id}-basics-001`,
  categoryKey: 'basics',
  difficulty: 2,
  prompt: 'Replace me: what makes a good first question?',
  options: [
    { key: 'A', text: 'A vague one' },
    { key: 'B', text: 'One with exactly one defensibly correct answer' },
    { key: 'C', text: 'A trick question' },
    { key: 'D', text: 'One with joke options' },
  ],
  correctKey: 'B',
  explanation:
    'Every question needs exactly one defensibly correct answer, plausible distractors, and an explanation that teaches why the answer is right and the tempting distractor is wrong.',
  source: 'original',
  reviewStatus: 'draft',
});

const AGENT_NOTE = (id) => `# ${id} — a quizmill learning pack

Edit pack.json and questions.json by hand, or point your AI agent at
this directory. The format is specified by the engine's Zod schema —
agents should loop on the validator until it exits clean:

    npx quizmill validate ${id}

Then run it:

    npx quizmill run ${id}

Quality bar: exactly one defensibly correct answer per question,
plausible distractors (no jokes), explanations that teach, difficulty
spread 1–5, and shuffle which letter is correct.
`;

function cmdNew(dirArg) {
  const dir = dirArg || 'my-pack';
  const id = path
    .basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!id) die(`cannot derive a pack id from "${dir}"`);
  if (fs.existsSync(dir)) die(`${dir} already exists`);
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, data) =>
    fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2) + '\n');
  write('pack.json', { ...TEMPLATE_MANIFEST(id), id });
  write('questions.json', [TEMPLATE_QUESTION(id)]);
  write('scenarios.json', []);
  fs.writeFileSync(path.join(dir, 'README.md'), AGENT_NOTE(id));
  log(`✓ scaffolded ${dir}/`);
  log(`  Edit it (or tell your agent: "fill ${dir} with questions about …"), then:`);
  log(`  npx quizmill run ${dir}`);
}

function cmdRun(arg) {
  const src = packSource(arg);
  if (src) engineNpm(['run', 'pack:use', src]);
  engineNpm(['run', 'dev']);
}

function cmdBuild(arg) {
  const src = packSource(arg);
  if (src) engineNpm(['run', 'pack:use', src]);
  engineNpm(['run', 'build']);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ENGINE, 'content', 'pack', 'pack.json'), 'utf8'),
  );
  const dest = path.resolve(`${manifest.id}-app`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(ENGINE, 'out'), dest, { recursive: true });
  log(`✓ static app for "${manifest.title}" in ${dest}/ — deploy it anywhere`);
}

function cmdValidate(arg) {
  if (!arg) die('usage: quizmill validate <pack-dir>');
  const src = packSource(arg);
  if (!fs.existsSync(src)) die(`not a directory: ${arg}`);
  engineNpm(['run', 'pack:validate', src]);
}

function cmdUpgrade() {
  ensureEngine();
  if (!process.env.QUIZMILL_ENGINE) {
    run('git', ['pull', '--ff-only'], { cwd: ENGINE });
  }
  run('npm', ['install', '--no-fund', '--no-audit'], { cwd: ENGINE });
  log('✓ engine up to date');
}

const HELP = `quizmill — the mill that grinds questions into knowledge
https://quizmill.dev

usage:
  quizmill new [dir]            scaffold a learning pack
  quizmill validate <dir>       schema + cross-reference checks
  quizmill run [dir|owner/repo] activate a pack (default: current/demo) and start the app
  quizmill build [dir|owner/repo]  build a static app into <pack-id>-app/
  quizmill list                 published packs you can install
  quizmill upgrade              update the cached engine (~/.quizmill)
  quizmill --version            print the CLI version (stamped into builds)

A learning pack is three JSON files. You can write them, but the
intended author is your AI agent — see the create-learning-pack skill
in the engine repo.`;

const [cmd, arg] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'new':       cmdNew(arg); break;
    case 'validate':  cmdValidate(arg); break;
    case 'run':       cmdRun(arg); break;
    case 'build':     cmdBuild(arg); break;
    case 'list':      engineNpm(['run', 'pack:list']); break;
    case 'upgrade':   cmdUpgrade(); break;
    case 'version':
    case '--version':
    case '-v':        log(CLI_VERSION); break;
    case 'help':
    case '--help':
    case undefined:   log(HELP); break;
    default:
      die(`unknown command "${cmd}" — try: quizmill help`);
  }
} catch (err) {
  // Child process failures already printed their output via stdio:inherit.
  process.exit(typeof err.status === 'number' ? err.status : 1);
}
