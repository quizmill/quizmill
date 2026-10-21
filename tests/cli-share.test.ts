/**
 * `quizmill share` end to end: the REAL CLI (a child process, this
 * checkout as its engine) validates and bundles a pack, uploads it over
 * HTTP to the REAL worker code (behind a node:http listener, with real
 * SQLite + an in-memory R2), and prints the link a learner taps. Then
 * the key management flags, and the link's key opening the pack the way
 * the app's /unlock route fetches it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import worker from '../cloudflare/src/worker';
import { makeD1, makeR2, openSqlite, type SqliteDatabase } from './helpers/worker-fakes';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'cli', 'bin', 'quizmill.js');
const ADMIN = 'QT-test-admin-token';
const KEY_SHAPE = /QL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/;
/** A bundle run spawns the engine's bundler (tsx), so these take seconds. */
const SLOW = 90_000;

let db: SqliteDatabase;
let env: { DB: ReturnType<typeof makeD1>; BUNDLES: ReturnType<typeof makeR2>; UNLOCK_ADMIN_TOKEN: string };
let server: http.Server;
let endpoint: string;
/** An endpoint nothing listens on. */
let unreachable: string;

/** node:http → the worker's fetch handler → node:http. */
function serveWorker(req: http.IncomingMessage, res: http.ServerResponse) {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', async () => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
    }
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const response = await worker.fetch(
      new Request(`${endpoint}${req.url}`, { method: req.method, headers, ...(body ? { body } : {}) }),
      env as never,
    );
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
}

beforeAll(async () => {
  server = http.createServer(serveWorker);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  endpoint = `http://127.0.0.1:${port}`;
  // Grab a free port and release it: nothing answers there afterwards.
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  unreachable = `http://127.0.0.1:${(probe.address() as { port: number }).port}`;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

let tmp: string;
let home: string;
beforeEach(() => {
  db = openSqlite();
  db.exec(fs.readFileSync(path.join(ROOT, 'cloudflare', 'schema.sql'), 'utf8'));
  env = { DB: makeD1(db), BUNDLES: makeR2(), UNLOCK_ADMIN_TOKEN: ADMIN };
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-share-'));
  home = path.join(tmp, 'home');
  fs.mkdirSync(home);
});
afterEach(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(unlock: Record<string, unknown>) {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ unlock }));
}

/** The CLI as a child process. Asynchronous on purpose: the worker it
 *  talks to is served by THIS process, so a blocking spawnSync would
 *  deadlock the two. */
function cli(...args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: tmp,
      // This checkout is the engine, so `share` bundles with the real
      // pack:bundle script and no clone happens.
      env: { ...process.env, QUIZMILL_HOME: home, QUIZMILL_ENGINE: ROOT },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (stderr += c));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** What the app's /unlock route does with the key in a link. */
async function unlock(key: string, init: RequestInit = {}) {
  const res = await fetch(`${endpoint}/v1/unlock?key=${encodeURIComponent(key)}`, {
    credentials: 'omit',
    ...init,
  });
  return { status: res.status, etag: res.headers.get('etag'), body: res.status === 200 ? await res.json() : null };
}

const linkKey = (text: string) => {
  const m = text.match(/\/unlock#key=(QL-[0-9A-Z-]+)/);
  return m ? m[1] : null;
};

describe('quizmill share', () => {
  it('refuses to start without a token, naming the config file', async () => {
    expect((await cli('new', 'study-set')).status).toBe(0);
    const r = await cli('share', 'study-set');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(path.join(home, 'config.json'));
    expect(r.stderr).toContain('UNLOCK_ADMIN_TOKEN');
    expect(env.BUNDLES.objects.size).toBe(0);
  });

  it('needs a pack directory, except to revoke', async () => {
    writeConfig({ endpoint, token: ADMIN });
    const bare = await cli('share');
    expect(bare.status).toBe(1);
    expect(bare.stderr).toContain('usage: quizmill share <dir>');
    expect((await cli('share', 'missing')).stderr).toContain('not a directory');
    expect((await cli('share', 'study-set', '--bogus')).stderr).toContain('unknown option "--bogus"');
  });

  it(
    'validates, bundles, uploads and prints one link per live key — and that link opens the pack',
    async () => {
      expect((await cli('new', 'study-set')).status).toBe(0);
      writeConfig({ endpoint, app: 'app.test', token: ADMIN });

      const first = await cli('share', 'study-set');
      expect(first.stderr).toBe('');
      expect(first.status).toBe(0);
      const lines = first.stdout.trim().split('\n');
      expect(lines[0]).toBe('Uploaded study-set (1 question, 1 KiB)');
      expect(lines[1]).toMatch(/^https:\/\/app\.test\/unlock#key=QL-/);
      expect(lines[1]).toMatch(KEY_SHAPE);
      expect(lines).toHaveLength(2);
      // The engine's bundler chatter is not repeated on success.
      expect(first.stdout).not.toContain('bundled');

      // What the worker stored is a real bundle of that pack, versioned.
      const stored = env.BUNDLES.objects.get('study-set.json')!;
      expect(stored).toBeDefined();
      const bundle = JSON.parse(stored.text);
      expect(bundle).toMatchObject({ format: 'quizmill-pack-bundle', id: 'study-set' });
      expect(bundle.manifest.id).toBe('study-set');
      expect(stored.customMetadata.version).toMatch(/^[0-9a-f]{7,}/);

      // Tapping the link: the key alone names the pack.
      const key = linkKey(lines[1])!;
      const got = await unlock(key);
      expect(got.status).toBe(200);
      expect(got.body.manifest.id).toBe('study-set');
      expect(got.body.questions).toHaveLength(1);
      expect(got.etag).toBe(`"${stored.customMetadata.version}"`);

      // Edit the pack and share again: same link, new bundle, keys untouched.
      const qFile = path.join(tmp, 'study-set', 'questions.json');
      const questions = JSON.parse(fs.readFileSync(qFile, 'utf8'));
      questions.push({ ...questions[0], id: 'study-set-basics-002', prompt: 'A second question?' });
      fs.writeFileSync(qFile, JSON.stringify(questions, null, 2));
      const second = await cli('share', 'study-set');
      expect(second.status).toBe(0);
      expect(second.stdout).toContain('Uploaded study-set (2 questions, ');
      expect(second.stdout).toContain(lines[1]);
      const again = await unlock(key, { headers: { 'if-none-match': got.etag! } });
      expect(again.status).toBe(200);
      expect(again.body.questions).toHaveLength(2);
      expect(again.etag).not.toBe(got.etag);
      expect(env.BUNDLES.objects.size).toBe(1);
    },
    SLOW,
  );

  it(
    'an invalid pack is refused by the validator before anything is uploaded',
    async () => {
      expect((await cli('new', 'study-set')).status).toBe(0);
      writeConfig({ endpoint, token: ADMIN });
      const qFile = path.join(tmp, 'study-set', 'questions.json');
      const questions = JSON.parse(fs.readFileSync(qFile, 'utf8'));
      questions[0].correctKey = 'Z';
      fs.writeFileSync(qFile, JSON.stringify(questions));
      const r = await cli('share', 'study-set');
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('correctKey');
      expect(r.stdout).not.toContain('Uploaded');
      expect(env.BUNDLES.objects.size).toBe(0);
    },
    SLOW,
  );

  it(
    '--new-key, --list and --revoke manage the keys without re-uploading',
    async () => {
      expect((await cli('new', 'study-set')).status).toBe(0);
      writeConfig({ endpoint, app: 'https://app.test/', token: ADMIN });
      const before = await cli('share', 'study-set', '--list');
      expect(before.status).toBe(0);
      expect(before.stdout).toContain('study-set: no licence keys yet');

      expect((await cli('share', 'study-set')).status).toBe(0);
      const firstKey = linkKey((await cli('share', 'study-set', '--list')).stdout)!;

      const minted = await cli('share', 'study-set', '--new-key', 'Leo');
      expect(minted.status).toBe(0);
      expect(minted.stdout).toContain('✓ new licence key for study-set (Leo)');
      const leoKey = linkKey(minted.stdout)!;
      expect(leoKey).not.toBe(firstKey);
      expect((await unlock(leoKey)).status).toBe(200);

      const list = await cli('share', 'study-set', '--list');
      expect(list.stdout).toContain('study-set — 2 licence keys');
      expect(list.stdout).toContain(`${firstKey}  0 uses  https://app.test/unlock#key=${firstKey}`);
      expect(list.stdout).toContain(`${leoKey}  Leo  1 use  https://app.test/unlock#key=${leoKey}`);

      const revoked = await cli('share', '--revoke', leoKey);
      expect(revoked.status).toBe(0);
      expect(revoked.stdout).toContain(`✓ revoked ${leoKey} (study-set)`);
      expect((await unlock(leoKey)).status).toBe(403);
      expect((await unlock(firstKey)).status).toBe(200);
      expect((await cli('share', 'study-set', '--list')).stdout).toMatch(
        new RegExp(`${leoKey}  Leo  1 use  revoked \\d{4}-`),
      );

      // The share summary lists only keys that still open the pack.
      const reshare = await cli('share', 'study-set');
      expect(reshare.stdout).toContain(firstKey);
      expect(reshare.stdout).not.toContain(leoKey);

      expect((await cli('share', '--revoke', 'QL-0000-0000-0000')).stderr).toContain('no such licence key');
    },
    SLOW,
  );

  it('--endpoint and --app override the config; a refused token is explained', async () => {
    expect((await cli('new', 'study-set')).status).toBe(0);
    writeConfig({ endpoint: unreachable, app: 'https://wrong.test', token: 'QT-wrong' });
    const refused = await cli('share', 'study-set', '--list', '--endpoint', endpoint);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('refused the token');

    writeConfig({ endpoint: unreachable, app: 'https://wrong.test', token: ADMIN });
    expect((await cli('share', 'study-set', '--list', '--endpoint', endpoint)).status).toBe(0);
    const down = await cli('share', 'study-set', '--list');
    expect(down.status).toBe(1);
    expect(down.stderr).toContain(`could not reach ${unreachable}`);
  });
});
