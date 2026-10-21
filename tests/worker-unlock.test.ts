/**
 * The licence-key unlock half of the sync worker: the key format, the
 * refusal rules and the upload checks — pure, like ops.ts — plus the
 * whole service run end to end (real worker → real SQLite loaded with
 * schema.sql → an in-memory R2) the way `quizmill share` and the app's
 * /unlock route drive it.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import worker from '../cloudflare/src/worker';
import { makeD1, makeR2, openSqlite, type SqliteDatabase } from './helpers/worker-fakes';
import {
  KEY_EXHAUSTED,
  KEY_NOT_RECOGNISED,
  KEY_OTHER_PACK,
  KEY_REVOKED,
  LICENCE_KEY_ALPHABET,
  LICENCE_KEY_LENGTH,
  MAX_LICENCE_KEY_LENGTH,
  adminTokenMatches,
  decideUnlock,
  etagMatches,
  generateLicenceKey,
  licenceKeyCandidates,
  normalizeLicenceKey,
  parseBundleUpload,
  parseMintRequest,
  type LicenceKeyRow,
} from '../cloudflare/src/unlock';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

const KEY_SHAPE = /^QL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

describe('licence key format', () => {
  it('mints QL-XXXX-XXXX-XXXX from Crockford base32', () => {
    expect(LICENCE_KEY_ALPHABET).toHaveLength(32);
    expect(LICENCE_KEY_LENGTH).toBe(12);
    for (let i = 0; i < 50; i++) expect(generateLicenceKey()).toMatch(KEY_SHAPE);
    // A byte's low five bits pick the symbol, so the mapping is exact.
    expect(generateLicenceKey((n) => new Uint8Array(n).fill(0))).toBe('QL-0000-0000-0000');
    expect(generateLicenceKey((n) => new Uint8Array(n).fill(31))).toBe('QL-ZZZZ-ZZZZ-ZZZZ');
    expect(generateLicenceKey((n) => new Uint8Array(n).fill(32 + 7))).toBe('QL-7777-7777-7777');
  });

  it('canonicalises typed input: case, separators, confusables, optional prefix', () => {
    expect(normalizeLicenceKey('QL-7F3K-9Q2M-X4PD')).toBe('QL-7F3K-9Q2M-X4PD');
    expect(normalizeLicenceKey('ql 7f3k 9q2m x4pd')).toBe('QL-7F3K-9Q2M-X4PD');
    expect(normalizeLicenceKey('7F3K9Q2MX4PD')).toBe('QL-7F3K-9Q2M-X4PD');
    expect(normalizeLicenceKey('QL-7F3K-9Q2M-X4PD\n')).toBe('QL-7F3K-9Q2M-X4PD');
    // Crockford: i / l read as 1, o as 0.
    expect(normalizeLicenceKey('QL-iF3K-lQ2M-o4PD')).toBe('QL-1F3K-1Q2M-04PD');
  });

  it('refuses anything that is not a key', () => {
    expect(normalizeLicenceKey('')).toBeNull();
    expect(normalizeLicenceKey('QL-7F3K-9Q2M')).toBeNull();
    expect(normalizeLicenceKey('QL-7F3K-9Q2M-X4PD-EXTRA')).toBeNull();
    expect(normalizeLicenceKey('QL-7F3K-9Q2M-X4PU')).toBeNull(); // U is not Crockford
    expect(normalizeLicenceKey('QM-H3KDA-P9RWX-T2MNQ-C7FGB')).toBeNull(); // a sync key
  });

  it('looks a key up as given first — stored keys are opaque — then as a typed QL key', () => {
    // A minted key: exact and canonical are the same string.
    expect(licenceKeyCandidates('QL-7F3K-9Q2M-X4PD')).toEqual(['QL-7F3K-9Q2M-X4PD']);
    // Typed: the exact input is tried before the canonical form.
    expect(licenceKeyCandidates('ql 7f3k 9q2m x4pd')).toEqual(['ql 7f3k 9q2m x4pd', 'QL-7F3K-9Q2M-X4PD']);
    // Another provider's format is looked up exactly, never reshaped.
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(licenceKeyCandidates(uuid)).toEqual([uuid]);
    expect(licenceKeyCandidates('x'.repeat(MAX_LICENCE_KEY_LENGTH))).toHaveLength(1);
    // Whitespace around a pasted key is not part of it, whatever its format.
    expect(licenceKeyCandidates(`  ${uuid}\n`)).toEqual([uuid]);
    expect(licenceKeyCandidates(' QL-7F3K-9Q2M-X4PD ')).toEqual(['QL-7F3K-9Q2M-X4PD']);
    // Only empty and over-long input is refused outright.
    expect(licenceKeyCandidates('')).toEqual([]);
    expect(licenceKeyCandidates('   ')).toEqual([]);
    expect(licenceKeyCandidates('x'.repeat(MAX_LICENCE_KEY_LENGTH + 1))).toEqual([]);
  });
});

describe('decideUnlock', () => {
  const row: LicenceKeyRow = {
    key: 'QL-7F3K-9Q2M-X4PD',
    pack_id: 'aws-genai-udemy',
    label: '',
    uses: 0,
    max_uses: null,
    created_at: '2026-10-21T00:00:00.000Z',
    revoked_at: null,
  };

  it('opens the pack a live key names, whatever pack hint it carries', () => {
    expect(decideUnlock(row)).toEqual({ ok: true, packId: 'aws-genai-udemy' });
    expect(decideUnlock(row, 'aws-genai-udemy')).toEqual({ ok: true, packId: 'aws-genai-udemy' });
    expect(decideUnlock({ ...row, uses: 4, max_uses: 5 }).ok).toBe(true);
  });

  it('403s an unknown, revoked or exhausted key with the server text', () => {
    expect(decideUnlock(null)).toEqual({ ok: false, status: 403, error: KEY_NOT_RECOGNISED });
    expect(decideUnlock({ ...row, revoked_at: '2026-10-22T00:00:00.000Z' })).toEqual({
      ok: false,
      status: 403,
      error: KEY_REVOKED,
    });
    expect(decideUnlock({ ...row, uses: 5, max_uses: 5 })).toEqual({
      ok: false,
      status: 403,
      error: KEY_EXHAUSTED,
    });
  });

  it('404s a pack hint the key does not open — only after the key itself passed', () => {
    expect(decideUnlock(row, 'other-pack')).toEqual({ ok: false, status: 404, error: KEY_OTHER_PACK });
    // An unknown key asking for a pack learns nothing about that pack.
    expect(decideUnlock(null, 'other-pack')).toMatchObject({ ok: false, status: 403 });
    expect(decideUnlock({ ...row, revoked_at: 'x' }, 'other-pack')).toMatchObject({ ok: false, status: 403 });
  });
});

describe('parseMintRequest', () => {
  it('defaults to an unlabelled, unlimited key', () => {
    expect(parseMintRequest(null)).toEqual({ label: '', maxUses: null });
    expect(parseMintRequest({})).toEqual({ label: '', maxUses: null });
    expect(parseMintRequest({ label: '  Leo  ', maxUses: 3 })).toEqual({ label: 'Leo', maxUses: 3 });
  });

  it('rejects a non-object, a long label, or a non-positive limit', () => {
    expect(parseMintRequest('Leo')).toBeNull();
    expect(parseMintRequest({ label: 'x'.repeat(81) })).toBeNull();
    expect(parseMintRequest({ maxUses: 0 })).toBeNull();
    expect(parseMintRequest({ maxUses: 1.5 })).toBeNull();
    expect(parseMintRequest({ maxUses: '3' })).toBeNull();
  });
});

const bundle = (id: string, extra: Record<string, unknown> = {}) => ({
  format: 'quizmill-pack-bundle',
  bundleVersion: 1,
  schemaVersion: 2,
  id,
  bundledAt: '2026-10-21T00:00:00.000Z',
  manifest: { schemaVersion: 2, id, title: 'Udemy study set' },
  questions: [{ id: `${id}-basics-001` }, { id: `${id}-basics-002` }],
  ...extra,
});

describe('parseBundleUpload', () => {
  it('accepts a bundle whose envelope and manifest agree with the path id', async () => {
    const out = await parseBundleUpload(bundle('aws-genai-udemy', { packVersion: 'abc1234' }), 'aws-genai-udemy');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.bundle.questions).toBe(2);
    expect(out.bundle.version).toBe('abc1234');
    expect(out.bundle.bytes).toBe(Buffer.byteLength(out.bundle.text));
    expect(JSON.parse(out.bundle.text).manifest.title).toBe('Udemy study set');
  });

  it('versions a dirty or unversioned bundle by its content', async () => {
    const dirty = await parseBundleUpload(bundle('p', { packVersion: 'abc1234-dirty' }), 'p');
    const none = await parseBundleUpload(bundle('p'), 'p');
    const edited = await parseBundleUpload(bundle('p', { manifest: { id: 'p', title: 'v2' } }), 'p');
    for (const o of [dirty, none, edited]) expect(o.ok).toBe(true);
    if (!dirty.ok || !none.ok || !edited.ok) return;
    expect(dirty.bundle.version).toMatch(/^[0-9a-f]{16}$/);
    expect(dirty.bundle.version).not.toBe(none.bundle.version);
    expect(none.bundle.version).not.toBe(edited.bundle.version);
    // Deterministic: the same content hashes the same.
    const again = await parseBundleUpload(bundle('p'), 'p');
    expect(again.ok && again.bundle.version).toBe(none.bundle.version);
  });

  it('refuses a non-bundle, a bundle for another pack, or one with no questions', async () => {
    const err = async (raw: unknown, id = 'p') => {
      const out = await parseBundleUpload(raw, id);
      return out.ok ? null : out.error;
    };
    expect(await err(null)).toMatch(/not a pack bundle/);
    expect(await err([])).toMatch(/not a pack bundle/);
    expect(await err({ manifest: { id: 'p' }, questions: [] })).toMatch(/not a pack bundle/);
    expect(await err(bundle('other'), 'p')).toMatch(/for pack "other", not "p"/);
    expect(await err(bundle('p', { manifest: { id: 'other' } }))).toMatch(/manifest id/);
    expect(await err(bundle('p', { questions: [] }))).toMatch(/no questions/);
  });
});

describe('etagMatches / adminTokenMatches', () => {
  it('matches exact, weak and listed ETags, and *', () => {
    expect(etagMatches('"abc"', '"abc"')).toBe(true);
    expect(etagMatches('W/"abc"', '"abc"')).toBe(true);
    expect(etagMatches('"x", "abc"', '"abc"')).toBe(true);
    expect(etagMatches('*', '"abc"')).toBe(true);
    expect(etagMatches('"abd"', '"abc"')).toBe(false);
    expect(etagMatches(null, '"abc"')).toBe(false);
  });

  it('compares the admin token and refuses when either side is missing', () => {
    expect(adminTokenMatches('QT-secret', 'QT-secret')).toBe(true);
    expect(adminTokenMatches('QT-secreT', 'QT-secret')).toBe(false);
    expect(adminTokenMatches('QT-secret', undefined)).toBe(false);
    expect(adminTokenMatches(null, 'QT-secret')).toBe(false);
    expect(adminTokenMatches('', '')).toBe(false);
  });
});

// ── Full pipeline: share-style uploads ↔ worker.fetch ↔ SQLite + R2 ────

const ADMIN = 'QT-test-admin-token';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the worker's JSON replies are asserted field by field below
type Reply = any;

describe('unlock service end-to-end (worker ↔ real SQLite + in-memory R2)', () => {
  let db: SqliteDatabase;
  let env: {
    DB: ReturnType<typeof makeD1>;
    BUNDLES?: ReturnType<typeof makeR2>;
    UNLOCK_ADMIN_TOKEN?: string;
  };

  beforeEach(() => {
    db = openSqlite();
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'schema.sql'), 'utf8'));
    env = { DB: makeD1(db), BUNDLES: makeR2(), UNLOCK_ADMIN_TOKEN: ADMIN };
  });
  afterEach(() => db.close());

  const call = async (pathAndQuery: string, init: RequestInit = {}) => {
    const res = await worker.fetch(new Request(`https://sync.test${pathAndQuery}`, init), env as never);
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, headers: res.headers, body: body as Reply };
  };
  const admin = (init: RequestInit = {}) => ({
    ...init,
    headers: { authorization: `Bearer ${ADMIN}`, ...(init.headers as Record<string, string>) },
  });
  const share = (id: string, extra: Record<string, unknown> = {}) =>
    call(`/v1/packs/${id}`, admin({ method: 'PUT', body: JSON.stringify(bundle(id, extra)) }));

  it('share → link → unlock: the first upload mints a key that serves the bundle with its version as ETag', async () => {
    const up = await share('aws-genai-udemy', { packVersion: 'abc1234' });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ ok: true, id: 'aws-genai-udemy', version: 'abc1234', questions: 2 });
    expect(up.body.keys).toHaveLength(1);
    const key: string = up.body.keys[0].key;
    expect(key).toMatch(KEY_SHAPE);
    expect(up.body.keys[0]).toMatchObject({ packId: 'aws-genai-udemy', label: '', uses: 0, maxUses: null, revokedAt: null });

    const got = await call(`/v1/unlock?key=${key}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('application/json');
    expect(got.headers.get('etag')).toBe('"abc1234"');
    expect(got.headers.get('access-control-allow-origin')).toBe('*');
    expect(got.headers.get('access-control-expose-headers')).toContain('etag');
    expect(got.body).toMatchObject({ format: 'quizmill-pack-bundle', id: 'aws-genai-udemy' });
    expect(got.body.manifest.id).toBe('aws-genai-udemy');
    expect(got.body.questions).toHaveLength(2);

    // A device that already holds this version gets 304, and it is not a use.
    const same = await call(`/v1/unlock?key=${key}`, { headers: { 'if-none-match': '"abc1234"' } });
    expect(same.status).toBe(304);
    expect(same.headers.get('etag')).toBe('"abc1234"');
    const list = await call('/v1/packs/aws-genai-udemy/keys', admin());
    expect(list.body.keys[0].uses).toBe(1);
  });

  it('typed keys are canonicalised, and a pack hint only matters for the right key', async () => {
    const { body } = await share('aws-genai-udemy');
    const key: string = body.keys[0].key;
    const typed = key.toLowerCase().replace(/-/g, ' ').replace(/^ql/, '');
    expect((await call(`/v1/unlock?key=${encodeURIComponent(typed)}`)).status).toBe(200);
    expect((await call(`/v1/unlock?key=${key}&pack=aws-genai-udemy`)).status).toBe(200);
    const other = await call(`/v1/unlock?key=${key}&pack=eleven-plus`);
    expect(other.status).toBe(404);
    expect(other.body).toEqual({ error: KEY_OTHER_PACK });
  });

  it('a missing, malformed or unknown key is refused alike — nothing says whether a pack exists', async () => {
    await share('aws-genai-udemy');
    for (const q of ['', '?key=', '?key=nope', '?key=QL-0000-0000-0000', '?key=QL-0000-0000-0000&pack=aws-genai-udemy', '?pack=aws-genai-udemy']) {
      const res = await call(`/v1/unlock${q}`);
      expect(res.status, q).toBe(403);
      expect(res.body, q).toEqual({ error: KEY_NOT_RECOGNISED });
    }
    // With the same words for a pack that was never shared.
    const res = await call('/v1/unlock?key=QL-0000-0000-0000&pack=never-shared');
    expect(res.body).toEqual({ error: KEY_NOT_RECOGNISED });
  });

  it('a revoked key is refused with the server text and stays listed; revoking twice is harmless', async () => {
    const { body } = await share('aws-genai-udemy');
    const key: string = body.keys[0].key;
    const gone = await call(`/v1/keys/${key}`, admin({ method: 'DELETE' }));
    expect(gone.status).toBe(200);
    expect(gone.body.key.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const refused = await call(`/v1/unlock?key=${key}`);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: KEY_REVOKED });

    const again = await call(`/v1/keys/${key}`, admin({ method: 'DELETE' }));
    expect(again.body.key.revokedAt).toBe(gone.body.key.revokedAt);
    expect((await call('/v1/keys/QL-0000-0000-0000', admin({ method: 'DELETE' }))).status).toBe(404);
    expect((await call('/v1/keys/not-a-key', admin({ method: 'DELETE' }))).status).toBe(404);

    const list = await call('/v1/packs/aws-genai-udemy/keys', admin());
    expect(list.body.keys).toHaveLength(1);
    expect(list.body.keys[0].revokedAt).toBe(gone.body.key.revokedAt);
  });

  it('a key with a use limit stops serving once it is spent', async () => {
    await share('aws-genai-udemy');
    const minted = await call(
      '/v1/packs/aws-genai-udemy/keys',
      admin({ method: 'POST', body: JSON.stringify({ label: 'Leo', maxUses: 2 }) }),
    );
    expect(minted.status).toBe(200);
    expect(minted.body.key).toMatchObject({ label: 'Leo', maxUses: 2, uses: 0 });
    const key: string = minted.body.key.key;
    expect((await call(`/v1/unlock?key=${key}`)).status).toBe(200);
    expect((await call(`/v1/unlock?key=${key}`)).status).toBe(200);
    const spent = await call(`/v1/unlock?key=${key}`);
    expect(spent.status).toBe(403);
    expect(spent.body).toEqual({ error: KEY_EXHAUSTED });
    // The pack's first key is untouched by the second one's limit.
    const list = await call('/v1/packs/aws-genai-udemy/keys', admin());
    expect(list.body.keys.map((k: { label: string; uses: number }) => [k.label, k.uses])).toEqual([
      ['', 0],
      ['Leo', 2],
    ]);
  });

  it('a key in another format, written straight to the table, unlocks, counts, lists and revokes as-is', async () => {
    await share('aws-genai-udemy');
    // What a private writer (another provider's licence) might insert:
    // 36 hyphenated characters, nothing like QL-XXXX-XXXX-XXXX.
    const opaque = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    db.prepare(
      "INSERT INTO licence_keys (key, pack_id, label, uses, max_uses, created_at, revoked_at) VALUES (?, 'aws-genai-udemy', 'provider', 0, 2, '2026-10-21T00:00:00.000Z', NULL)",
    ).run(opaque);

    const got = await call(`/v1/unlock?key=${opaque}`);
    expect(got.status).toBe(200);
    expect(got.body.id).toBe('aws-genai-udemy');
    expect((await call(`/v1/unlock?key=${opaque}&pack=aws-genai-udemy`)).status).toBe(200);
    expect((await call(`/v1/unlock?key=${opaque}`)).body).toEqual({ error: KEY_EXHAUSTED });
    // Case matters: the key is what the table holds, not a reshaped form.
    expect((await call(`/v1/unlock?key=${opaque.toUpperCase()}`)).body).toEqual({ error: KEY_NOT_RECOGNISED });

    const list = await call('/v1/packs/aws-genai-udemy/keys', admin());
    expect(list.body.keys.map((k: { key: string; uses: number }) => [k.key, k.uses])).toContainEqual([opaque, 2]);

    const gone = await call(`/v1/keys/${opaque}`, admin({ method: 'DELETE' }));
    expect(gone.status).toBe(200);
    expect(gone.body.key).toMatchObject({ key: opaque, uses: 2 });
    expect(gone.body.key.revokedAt).toMatch(/^\d{4}-/);
    expect((await call(`/v1/unlock?key=${opaque}`)).body).toEqual({ error: KEY_REVOKED });

    // Only empty and over-long keys are refused without a lookup — with the usual words.
    const long = 'x'.repeat(MAX_LICENCE_KEY_LENGTH + 1);
    expect((await call(`/v1/unlock?key=${long}`)).body).toEqual({ error: KEY_NOT_RECOGNISED });
    expect((await call(`/v1/keys/${long}`, admin({ method: 'DELETE' }))).status).toBe(404);
  });

  it('two unlocks racing for the last use of a key: exactly one is served', async () => {
    await share('aws-genai-udemy');
    const minted = await call(
      '/v1/packs/aws-genai-udemy/keys',
      admin({ method: 'POST', body: JSON.stringify({ maxUses: 1 }) }),
    );
    const key: string = minted.body.key.key;
    // Both read `uses = 0` before either records a use: the claim must be
    // atomic, not read-then-write.
    const [a, b] = await Promise.all([call(`/v1/unlock?key=${key}`), call(`/v1/unlock?key=${key}`)]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
    const refused = a.status === 403 ? a : b;
    expect(refused.body).toEqual({ error: KEY_EXHAUSTED });
    const list = await call('/v1/packs/aws-genai-udemy/keys', admin());
    expect(list.body.keys.find((k: { key: string }) => k.key === key).uses).toBe(1);
  });

  it('a key revoked while its bundle is being read is not served', async () => {
    const { body } = await share('aws-genai-udemy');
    const key: string = body.keys[0].key;
    const bucket = env.BUNDLES!;
    const realGet = bucket.get;
    bucket.get = async (k: string) => {
      // The author revokes between the key check and the download.
      await call(`/v1/keys/${key}`, admin({ method: 'DELETE' }));
      return realGet(k);
    };
    const res = await call(`/v1/unlock?key=${key}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: KEY_REVOKED });
    bucket.get = realGet;
    const list = await call('/v1/packs/aws-genai-udemy/keys', admin());
    expect(list.body.keys[0].uses).toBe(0);
  });

  it('re-sharing replaces the bundle and leaves the keys alone', async () => {
    const first = await share('aws-genai-udemy', { packVersion: 'abc1234' });
    const key: string = first.body.keys[0].key;
    const second = await share('aws-genai-udemy', {
      packVersion: 'def5678',
      questions: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }],
    });
    expect(second.body.keys).toEqual(first.body.keys);
    expect(second.body.questions).toBe(3);

    // The old version no longer matches, so the device gets the new bundle.
    const got = await call(`/v1/unlock?key=${key}`, { headers: { 'if-none-match': '"abc1234"' } });
    expect(got.status).toBe(200);
    expect(got.headers.get('etag')).toBe('"def5678"');
    expect(got.body.questions).toHaveLength(3);
    expect(env.BUNDLES!.objects.size).toBe(1);
  });

  it('refuses an upload that is not this pack, and keeps what was there', async () => {
    await share('aws-genai-udemy', { packVersion: 'abc1234' });
    const wrong = await call(
      '/v1/packs/aws-genai-udemy',
      admin({ method: 'PUT', body: JSON.stringify(bundle('eleven-plus')) }),
    );
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/for pack "eleven-plus"/);
    expect((await call('/v1/packs/aws-genai-udemy', admin({ method: 'PUT', body: 'nope' }))).status).toBe(400);
    expect((await call('/v1/packs/Bad_Id', admin({ method: 'PUT', body: '{}' }))).status).toBe(400);
    const big = await call(
      '/v1/packs/aws-genai-udemy',
      admin({ method: 'PUT', body: '{}', headers: { 'content-length': String(30 * 1024 * 1024) } }),
    );
    expect(big.status).toBe(413);
    expect(env.BUNDLES!.objects.get('aws-genai-udemy.json')!.customMetadata.version).toBe('abc1234');
    expect(env.BUNDLES!.objects.has('eleven-plus.json')).toBe(false);
  });

  it('a key cannot be minted for a pack that has no bundle', async () => {
    const res = await call('/v1/packs/eleven-plus/keys', admin({ method: 'POST' }));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/share the pack first/);
    expect((await call('/v1/packs/eleven-plus/keys', admin())).body).toEqual({ keys: [] });
  });

  it('admin routes need the admin token; the service is absent without the bucket', async () => {
    for (const [method, p] of [
      ['PUT', '/v1/packs/aws-genai-udemy'],
      ['GET', '/v1/packs/aws-genai-udemy/keys'],
      ['POST', '/v1/packs/aws-genai-udemy/keys'],
      ['DELETE', '/v1/keys/QL-0000-0000-0000'],
    ] as const) {
      expect((await call(p, { method })).status, `${method} ${p}`).toBe(401);
      expect((await call(p, { method, headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
      // A sync key is not an admin token either.
      expect(
        (await call(p, { method, headers: { authorization: 'Bearer QM-H3KDA-P9RWX-T2MNQ-C7FGB' } })).status,
      ).toBe(401);
    }
    delete env.UNLOCK_ADMIN_TOKEN;
    expect((await call('/v1/packs/aws-genai-udemy/keys', admin())).status).toBe(401);

    delete env.BUNDLES;
    env.UNLOCK_ADMIN_TOKEN = ADMIN;
    expect((await call('/v1/unlock?key=QL-0000-0000-0000')).status).toBe(401);
    expect((await call('/v1/packs/aws-genai-udemy/keys', admin())).status).toBe(401);
  });

  it('answers the CORS preflight the app sends for a cross-origin unlock', async () => {
    const res = await call('/v1/unlock', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('if-none-match');
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
  });

  // Keys are opaque strings: `QL-…` is what `share` mints, not what the
  // service requires (#200). A writer with table access may store keys in
  // any format and they must unlock, list and revoke exactly like a
  // minted one.
  it('a key in any format is served as stored; a typed QL key still folds; the refusals stay uniform', async () => {
    await share('exam-set');
    const insert = (key: string) =>
      db
        .prepare(
          "INSERT INTO licence_keys (key, pack_id, label, uses, max_uses, created_at, revoked_at) VALUES (?, 'exam-set', '', 0, NULL, '2026-10-21T00:00:00.000Z', NULL)",
        )
        .run(key);

    // 1. Another provider's format, inserted directly: unlocks, lists, revokes.
    const foreign = 'ABCD1234-EFGH5678-IJKL9012-MNOP3456';
    insert(foreign);
    const got = await call(`/v1/unlock?key=${foreign}`);
    expect(got.status).toBe(200);
    expect(got.body.id).toBe('exam-set');
    // A pasted key keeps its surrounding whitespace out of the lookup.
    expect((await call(`/v1/unlock?key=${encodeURIComponent(`  ${foreign}\n`)}`)).status).toBe(200);
    const listed = await call('/v1/packs/exam-set/keys', admin());
    expect(listed.body.keys.map((k: { key: string }) => k.key)).toContain(foreign);
    const revoked = await call(`/v1/keys/${foreign}`, admin({ method: 'DELETE' }));
    expect(revoked.status).toBe(200);
    expect(revoked.body.key).toMatchObject({ key: foreign, packId: 'exam-set', uses: 2 });
    expect((await call(`/v1/unlock?key=${foreign}`)).body).toEqual({ error: KEY_REVOKED });

    // 2. A minted-style key typed with the Crockford confusables and no prefix.
    insert('QL-1F3K-1Q2M-04PD');
    const typed = encodeURIComponent(' if3k lq2m o4pd ');
    expect((await call(`/v1/unlock?key=${typed}`)).status).toBe(200);
    expect((await call(`/v1/keys/${typed}`, admin({ method: 'DELETE' }))).body.key.key).toBe('QL-1F3K-1Q2M-04PD');

    // 3. Empty and over-long keys get the unknown-key words.
    for (const key of ['', encodeURIComponent('   '), 'k'.repeat(200)]) {
      const res = await call(`/v1/unlock?key=${key}`);
      expect(res.status, key).toBe(403);
      expect(res.body, key).toEqual({ error: KEY_NOT_RECOGNISED });
    }

    // 4. An unknown key in a non-QL format learns nothing about packs:
    //    the same words with a pack that exists, one that does not, and none.
    const unknown = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    for (const q of ['', '&pack=exam-set', '&pack=never-shared']) {
      const res = await call(`/v1/unlock?key=${unknown}${q}`);
      expect(res.status, q).toBe(403);
      expect(res.body, q).toEqual({ error: KEY_NOT_RECOGNISED });
    }
  });
});
