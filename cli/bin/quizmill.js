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
 *   npx quizmill bundle my-topic     one <pack-id>.bundle.json to hand over
 *   npx quizmill share my-topic      upload the bundle to the unlock service, print the link
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
// The engine ref this CLI builds with: its own release tag, so the CLI and
// engine stay in lockstep (a dev build — the 0.0.0-dev sentinel — tracks main).
const ENGINE_REF = CLI_VERSION === '0.0.0-dev' ? 'main' : `v${CLI_VERSION}`;
const REF_MARKER = path.join(ENGINE, '.quizmill-engine-ref');

const log = (s) => console.log(s);
const die = (s) => {
  console.error(`✗ ${s}`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

/** Fetch a ref (tag or branch) into the cache and hard-reset onto it. */
function fetchRef(ref) {
  run('git', ['fetch', '--depth', '1', 'origin', ref], { cwd: ENGINE });
  run('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: ENGINE });
  fs.writeFileSync(REF_MARKER, ref);
  // package.json can differ between versions — force a clean reinstall.
  fs.rmSync(path.join(ENGINE, 'node_modules'), { recursive: true, force: true });
}

function ensureEngine() {
  if (!fs.existsSync(path.join(ENGINE, 'package.json'))) {
    log(`… fetching the quizmill engine (${ENGINE_REF}) into ${ENGINE}`);
    fs.mkdirSync(path.dirname(ENGINE), { recursive: true });
    try {
      run('git', ['clone', '--depth', '1', '--branch', ENGINE_REF, ENGINE_REPO, ENGINE]);
      fs.writeFileSync(REF_MARKER, ENGINE_REF);
    } catch {
      // The tag may not be published yet (a just-released CLI) — use main.
      fs.rmSync(ENGINE, { recursive: true, force: true });
      run('git', ['clone', '--depth', '1', '--branch', 'main', ENGINE_REPO, ENGINE]);
      fs.writeFileSync(REF_MARKER, 'main');
    }
  } else if (!process.env.QUIZMILL_ENGINE) {
    // Keep the cached engine in lockstep with this CLI version — so
    // `npx quizmill@latest build` always uses the matching engine.
    const current = fs.existsSync(REF_MARKER)
      ? fs.readFileSync(REF_MARKER, 'utf8').trim()
      : '';
    if (current !== ENGINE_REF) {
      log(`… aligning engine to ${ENGINE_REF}`);
      try {
        fetchRef(ENGINE_REF);
      } catch {
        log('  (offline or ref missing — using the cached engine as-is)');
      }
    }
  }
  if (!fs.existsSync(path.join(ENGINE, 'node_modules'))) {
    log('… installing engine dependencies');
    run('npm', ['install', '--no-fund', '--no-audit'], { cwd: ENGINE });
  }
}

function engineSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ENGINE }).toString().trim();
  } catch {
    return '?';
  }
}

/** Run one of the engine's npm scripts. `quiet` swallows its stdout (the
 *  caller prints its own summary); stderr — the validator's errors — is
 *  always passed through. */
function engineNpm(args, { quiet = false } = {}) {
  ensureEngine();
  const env = { ...process.env };
  // Stamp the build with the CLI version, which always matches the pinned
  // engine ref — robust even if the cache fell back to main (no tag, so the
  // engine's own git-describe would land on the 0.0.0-dev sentinel).
  // Skipped under QUIZMILL_ENGINE (let a real checkout's git tags win) or
  // when the caller set the version explicitly.
  if (!process.env.QUIZMILL_ENGINE && !env.NEXT_PUBLIC_APP_VERSION) {
    env.NEXT_PUBLIC_APP_VERSION = CLI_VERSION;
  }
  run('npm', args, { cwd: ENGINE, env, ...(quiet ? { stdio: ['inherit', 'pipe', 'inherit'] } : {}) });
}

/** Resolve a pack argument: absolute path for dirs, verbatim otherwise
 *  (the engine handles owner/repo and URLs itself). */
function packSource(arg) {
  if (!arg) return null;
  return fs.existsSync(arg) ? path.resolve(arg) : arg;
}

const TEMPLATE_MANIFEST = (id) => ({
  schemaVersion: 2,
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
  write('pack.json', TEMPLATE_MANIFEST(id));
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

/** The pack id from <dir>/pack.json, for naming the default bundle file;
 *  null when the manifest can't be read (the engine's validator will
 *  explain why, so don't die here). */
function packIdOf(dir) {
  try {
    const id = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')).id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

function cmdBundle(arg, rest) {
  if (!arg) die('usage: quizmill bundle <pack-dir> [--out file]');
  const src = packSource(arg);
  if (!fs.existsSync(src)) die(`not a directory: ${arg}`);
  let out = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--out' || a === '-o') {
      out = rest[++i];
      if (!out) die('--out needs a file path');
    } else if (a.startsWith('--out=')) {
      out = a.slice('--out='.length);
    } else {
      die(`unknown option "${a}" — usage: quizmill bundle <pack-dir> [--out file]`);
    }
  }
  // The engine runs from its own checkout, so hand it an absolute target
  // (default: <pack-id>.bundle.json where the user typed the command).
  const target = path.resolve(out || `${packIdOf(src) || path.basename(src)}.bundle.json`);
  engineNpm(['run', 'pack:bundle', '--', src, '--out', target]);
}

// ── share: a private pack behind a licence key ──────────────────────────
//
// `share` is `bundle` with the file going to the unlock service instead
// of the desk: the engine validates and bundles the pack, the CLI PUTs
// the bundle to `<endpoint>/v1/packs/<id>` with the admin token, and the
// service answers with the pack's licence keys — minting the first one
// on the first upload. Each key becomes a link to the home app
// (`<app>/unlock#key=…`): tapping it on a phone fetches the bundle with
// the key, inserts the pack and makes it active, no file picker. The
// key rides in the fragment, which no server or log ever sees.
// Re-running `share` replaces the bundle and leaves the keys alone, so
// links keep working and (same pack id) learners keep their progress.
//
// Settings live in ~/.quizmill/config.json:
//   { "unlock": { "endpoint": "https://sync.quizmill.dev",
//                 "app": "https://app.quizmill.dev", "token": "QT-…" } }
// `endpoint` and `app` have defaults; `token` is the service's
// UNLOCK_ADMIN_TOKEN and has none.

const CONFIG_FILE = path.join(HOME, 'config.json');
const DEFAULT_UNLOCK_ENDPOINT = 'https://sync.quizmill.dev';
const DEFAULT_UNLOCK_APP = 'https://app.quizmill.dev';

/** The `unlock` block of the config file, `{}` when there is none. */
function readUnlockConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return parsed && typeof parsed.unlock === 'object' && parsed.unlock ? parsed.unlock : {};
  } catch {
    return {};
  }
}

/** An origin typed without a scheme (`app.quizmill.dev`) means https. */
function withScheme(origin) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(origin) ? origin : `https://${origin}`;
}

function parseShareArgs(arg, rest) {
  const opts = { dir: null, list: false, newKey: null, revoke: null, app: null, endpoint: null };
  const argv = arg === undefined ? rest : [arg, ...rest];
  const usage =
    'usage: quizmill share <dir> [--new-key [label]] [--list] [--app <origin>] [--endpoint <url>]\n' +
    '       quizmill share --revoke <key>';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (flag) => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) die(`${flag} needs a value — ${usage}`);
      return v;
    };
    if (a === '--list') opts.list = true;
    else if (a === '--new-key') {
      // The label is optional: the next word is one unless it is a flag.
      opts.newKey = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : '';
    } else if (a.startsWith('--new-key=')) opts.newKey = a.slice('--new-key='.length);
    else if (a === '--revoke') opts.revoke = value('--revoke');
    else if (a.startsWith('--revoke=')) opts.revoke = a.slice('--revoke='.length);
    else if (a === '--app') opts.app = value('--app');
    else if (a.startsWith('--app=')) opts.app = a.slice('--app='.length);
    else if (a === '--endpoint') opts.endpoint = value('--endpoint');
    else if (a.startsWith('--endpoint=')) opts.endpoint = a.slice('--endpoint='.length);
    else if (a.startsWith('-')) die(`unknown option "${a}" — ${usage}`);
    else if (opts.dir === null) opts.dir = a;
    else die(`unexpected argument "${a}" — ${usage}`);
  }
  if (opts.dir === null && opts.revoke === null) die(usage);
  return opts;
}

/** One request to the unlock service's admin routes; dies with the
 *  service's own words on anything but a 2xx. */
async function unlockApi(cfg, method, route, body) {
  const url = `${cfg.endpoint.replace(/\/+$/, '')}${route}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${cfg.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body } : {}),
    });
  } catch (err) {
    die(`could not reach ${cfg.endpoint}: ${err.cause ? err.cause.message : err.message}`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // a non-JSON answer: reported by status below
  }
  if (res.status === 401) {
    die(`${cfg.endpoint} refused the token in ${CONFIG_FILE} (unlock.token)`);
  }
  if (!res.ok) {
    die(`${method} ${route} → HTTP ${res.status}${data && data.error ? `: ${data.error}` : ''}`);
  }
  return data;
}

const unlockLink = (cfg, key) => `${cfg.app.replace(/\/+$/, '')}/unlock#key=${key}`;

/** `--list`: every key of the pack, spent and revoked ones included. */
function printKeys(cfg, id, keys) {
  if (keys.length === 0) {
    log(`${id}: no licence keys yet — run \`quizmill share <dir>\` to upload and mint one`);
    return;
  }
  log(`${id} — ${keys.length} licence key${keys.length === 1 ? '' : 's'}`);
  for (const k of keys) {
    const uses = k.maxUses === null ? `${k.uses} use${k.uses === 1 ? '' : 's'}` : `${k.uses}/${k.maxUses} uses`;
    const state = k.revokedAt
      ? `revoked ${k.revokedAt.slice(0, 10)}`
      : k.maxUses !== null && k.uses >= k.maxUses
        ? 'spent'
        : unlockLink(cfg, k.key);
    log(`  ${k.key}  ${k.label ? `${k.label}  ` : ''}${uses}  ${state}`);
  }
}

async function cmdShare(arg, rest) {
  const opts = parseShareArgs(arg, rest);
  const file = readUnlockConfig();
  const cfg = {
    endpoint: opts.endpoint || file.endpoint || DEFAULT_UNLOCK_ENDPOINT,
    app: withScheme(opts.app || file.app || DEFAULT_UNLOCK_APP),
    token: typeof file.token === 'string' ? file.token.trim() : '',
  };
  if (!cfg.token) {
    die(
      `no unlock token — put the service's UNLOCK_ADMIN_TOKEN in ${CONFIG_FILE}:\n` +
        `  { "unlock": { "endpoint": "${cfg.endpoint}", "app": "${cfg.app}", "token": "…" } }`,
    );
  }

  if (opts.revoke !== null) {
    const data = await unlockApi(cfg, 'DELETE', `/v1/keys/${encodeURIComponent(opts.revoke)}`);
    const k = data.key || {};
    log(`✓ revoked ${k.key || opts.revoke}${k.packId ? ` (${k.packId})` : ''} — its link no longer unlocks anything`);
    return;
  }

  const src = packSource(opts.dir);
  if (!fs.existsSync(src)) die(`not a directory: ${opts.dir}`);
  const id = packIdOf(src);
  if (!id) die(`${opts.dir}/pack.json has no readable "id" — run \`quizmill validate ${opts.dir}\``);

  if (opts.list) {
    const data = await unlockApi(cfg, 'GET', `/v1/packs/${id}/keys`);
    printKeys(cfg, id, data.keys || []);
    return;
  }
  if (opts.newKey !== null) {
    const data = await unlockApi(cfg, 'POST', `/v1/packs/${id}/keys`, JSON.stringify({ label: opts.newKey }));
    log(`✓ new licence key for ${id}${opts.newKey ? ` (${opts.newKey})` : ''}`);
    log(unlockLink(cfg, data.key.key));
    return;
  }

  // Validate + bundle via the engine (it refuses an invalid pack, with the
  // validator's errors on stderr), through a scratch file the engine
  // writes and the CLI reads straight back — nothing is left on disk.
  const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'quizmill-share-')), `${id}.json`);
  let text;
  try {
    engineNpm(['run', 'pack:bundle', '--', src, '--out', scratch], { quiet: true });
    text = fs.readFileSync(scratch, 'utf8');
  } finally {
    fs.rmSync(path.dirname(scratch), { recursive: true, force: true });
  }
  const data = await unlockApi(cfg, 'PUT', `/v1/packs/${id}`, text);
  const kib = Math.round(Buffer.byteLength(text) / 1024);
  log(`Uploaded ${id} (${data.questions} question${data.questions === 1 ? '' : 's'}, ${kib} KiB)`);
  const live = (data.keys || []).filter((k) => !k.revokedAt && (k.maxUses === null || k.uses < k.maxUses));
  for (const k of live) log(`${unlockLink(cfg, k.key)}${k.label ? `  (${k.label})` : ''}`);
  if (live.length === 0) log(`(no live licence key — mint one with \`quizmill share ${opts.dir} --new-key\`)`);
}

function cmdUpgrade() {
  if (process.env.QUIZMILL_ENGINE) {
    ensureEngine();
    log(`✓ quizmill ${CLI_VERSION} — using QUIZMILL_ENGINE (${engineSha()})`);
    return;
  }
  // Force a re-align to this CLI's engine ref (blank the marker so
  // ensureEngine re-fetches even if it thinks it's already current).
  const before = engineSha();
  if (fs.existsSync(REF_MARKER)) fs.writeFileSync(REF_MARKER, '');
  ensureEngine();
  const after = engineSha();
  log(before === after ? `engine already current (${after})` : `engine ${before} → ${after}`);
  log(`✓ quizmill ${CLI_VERSION} — engine at ${ENGINE_REF}`);
}

const HELP = `quizmill — the mill that grinds questions into knowledge
https://quizmill.dev

usage:
  quizmill new [dir]            scaffold a learning pack
  quizmill validate <dir>       schema + cross-reference checks
  quizmill run [dir|owner/repo] activate a pack (default: current/demo) and start the app
  quizmill build [dir|owner/repo]  build a static app into <pack-id>-app/
  quizmill bundle <dir> [--out file]  one <pack-id>.bundle.json, images inside — insert it at /packs
  quizmill share <dir>          upload the bundle to the unlock service; prints the licence-key link
    --new-key [label] | --list | --revoke <key> | --app <origin> | --endpoint <url>
  quizmill list                 published packs you can install
  quizmill upgrade              update the cached engine (~/.quizmill)
  quizmill --version            print the CLI version (stamped into builds)

A learning pack is three JSON files. You can write them, but the
intended author is your AI agent — see the create-learning-pack skill
in the engine repo.`;

const [cmd, arg, ...rest] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'new':       cmdNew(arg); break;
    case 'validate':  cmdValidate(arg); break;
    case 'run':       cmdRun(arg); break;
    case 'build':     cmdBuild(arg); break;
    case 'bundle':    cmdBundle(arg, rest); break;
    case 'share':
      // The only async command (it talks HTTP); failures end the process
      // the same way the synchronous ones do.
      cmdShare(arg, rest).catch((err) => {
        process.exit(typeof err.status === 'number' ? err.status : 1);
      });
      break;
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
