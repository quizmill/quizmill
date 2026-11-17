/**
 * Unlocked packs update themselves (src/lib/packUpdates.ts): once a day
 * per pack with a stored licence key, the app asks the unlock endpoint
 * for the bundle with `If-None-Match: "<stored version>"`. 304 → nothing;
 * 200 → the pack is re-inserted (same id, progress kept) and Home is
 * told once; 403 → that pack is left alone until a key is entered again;
 * offline → try again next open. Everything here runs against a stubbed
 * fetch — the key goes nowhere but the request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PACK_UPDATED_EVENT,
  PACK_UPDATE_INTERVAL_MS,
  checkPackUpdates,
  loadUpdateCheck,
  stashPackUpdatedNotice,
  takePackUpdatedNotices,
  updateDue,
} from '@/lib/packUpdates';
import {
  activatePack,
  ejectPack,
  getActivePackPointer,
  getInsertedPack,
  insertPack,
  listInsertedPacks,
} from '@/lib/packLibrary';
import { DEFAULT_UNLOCK_URL, licenceKeyStorageKey, unlockPack } from '@/lib/unlock';
import { loadEvents } from '@/lib/storage';

const BUILD = 'solar-system-demo';
const KEY = 'QL-7F3A-TEST-KEY1';
const NOW = 1_800_000_000_000;

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    keys: () => [...map.keys()],
    dump: () => JSON.stringify([...map.entries()]),
  };
}

/** A minimal valid v2 bundle with `n` questions, as the endpoint serves it. */
function bundle(id: string, n: number, packVersion?: string) {
  const question = (i: number) => ({
    id: `${id}-planets-00${i}`,
    categoryKey: 'planets',
    difficulty: 1,
    prompt: `Question ${i}: which planet is the largest?`,
    options: [
      { key: 'A', text: 'Jupiter' },
      { key: 'B', text: 'Mars' },
    ],
    correctKey: 'A',
    explanation: 'Jupiter is the largest planet in the solar system by far.',
    source: 'original',
    reviewStatus: 'draft',
  });
  return {
    format: 'quizmill-pack-bundle',
    ...(packVersion ? { packVersion } : {}),
    manifest: {
      schemaVersion: 2,
      id,
      title: `Pack ${id}`,
      description: 'A pack that arrived through a licence key.',
      homeSubtitle: 'Every planet, every moon.',
      themeColor: '#123456',
      categories: [{ key: 'planets', label: 'Planets' }],
    },
    questions: Array.from({ length: n }, (_, i) => question(i + 1)),
  };
}

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];
let storage: ReturnType<typeof fakeStorage>;
let session: ReturnType<typeof fakeStorage>;
let dispatched: string[];

function respond(status: number, body?: unknown, headers: Record<string, string> = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as typeof fetch;
}

function header(call: FetchCall, name: string): string | null {
  return new Headers(call.init?.headers).get(name);
}

/** An unlocked pack on the shelf: content, index entry (with the endpoint it
 *  came from — `unlockUrl: null` for an entry from before that was kept),
 *  licence, progress. */
async function seedUnlocked(
  id: string,
  opts: { version?: string; unlockUrl?: string | null; active?: boolean } = {},
) {
  const unlockUrl = opts.unlockUrl === undefined ? DEFAULT_UNLOCK_URL : opts.unlockUrl;
  const r = await insertPack(bundle(id, 3), {
    origin: 'licence key · unlock.example.com',
    buildPackId: BUILD,
    ...(opts.version ? { packVersion: opts.version } : {}),
    ...(unlockUrl ? { unlockUrl } : {}),
  });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  storage.setItem(licenceKeyStorageKey(id), KEY);
  storage.setItem(
    `quizmill.${id}.attempts.v1`,
    JSON.stringify([{ id: 'a1', questionId: `${id}-planets-001`, isCorrect: true, answeredAt: 1 }]),
  );
  if (opts.active) await activatePack(id);
}

beforeEach(() => {
  calls = [];
  dispatched = [];
  storage = fakeStorage();
  session = fakeStorage();
  vi.stubGlobal('window', {
    localStorage: storage,
    sessionStorage: session,
    dispatchEvent: (e: Event) => {
      dispatched.push(e.type);
      return true;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkPackUpdates — who is asked', () => {
  it('asks only for inserted packs that hold a licence key, once a day each', async () => {
    await seedUnlocked('paid-pack', { version: 'v1' });
    await insertPack(bundle('free-pack', 2), { buildPackId: BUILD }); // no key → never asked
    const first = await checkPackUpdates({ buildPackId: BUILD, fetchImpl: respond(304), now: NOW });
    expect(first).toEqual({ 'paid-pack': 'current' });
    expect(calls).toHaveLength(1);
    expect(loadUpdateCheck('paid-pack')).toEqual({ checkedAt: NOW });

    // Within the day: nothing leaves the device.
    const again = await checkPackUpdates({
      buildPackId: BUILD,
      fetchImpl: respond(304),
      now: NOW + PACK_UPDATE_INTERVAL_MS - 1,
    });
    expect(again).toEqual({});
    expect(calls).toHaveLength(1);

    // A day later it is due again.
    await checkPackUpdates({ buildPackId: BUILD, fetchImpl: respond(304), now: NOW + PACK_UPDATE_INTERVAL_MS });
    expect(calls).toHaveLength(2);
  });

  it('sends the key, the pack id and the stored version as If-None-Match — no cookies', async () => {
    await seedUnlocked('paid-pack', { version: 'v1', unlockUrl: 'https://author.test/api' });
    await checkPackUpdates({ buildPackId: BUILD, fetchImpl: respond(304), now: NOW });
    expect(calls[0].url).toBe(`https://author.test/api/v1/unlock?key=${KEY}&pack=paid-pack`);
    expect(header(calls[0], 'if-none-match')).toBe('"v1"');
    expect(calls[0].init?.credentials).toBe('omit');
  });

  it('sends no If-None-Match for an entry without a version', async () => {
    await seedUnlocked('older-pack');
    await checkPackUpdates({ buildPackId: BUILD, fetchImpl: respond(304), now: NOW });
    expect(calls[0].url).toBe(`${DEFAULT_UNLOCK_URL}/v1/unlock?key=${KEY}&pack=older-pack`);
    expect(header(calls[0], 'if-none-match')).toBeNull();
  });

  it('never asks about a pack whose endpoint it does not know — the key goes only where it was accepted', async () => {
    // An entry from before the endpoint was kept. The active pack's
    // manifest may name an unlock endpoint of its own; that publisher
    // must not receive another pack's key.
    await seedUnlocked('older-pack', { version: 'v1', unlockUrl: null });
    expect(updateDue(listInsertedPacks()[0], NOW)).toBe(false);
    expect(await checkPackUpdates({ buildPackId: BUILD, fetchImpl: respond(304), now: NOW })).toEqual({});
    expect(calls).toHaveLength(0);
    expect(loadUpdateCheck('older-pack')).toBeNull();

    // A key entered again records where it was accepted, and the checks start.
    const unlocked = await unlockPack(KEY, {
      config: { unlockUrl: 'https://author.test/api' },
      buildPackId: BUILD,
      fetchImpl: respond(200, bundle('older-pack', 3), { etag: '"v2"' }),
    });
    expect(unlocked.ok).toBe(true);
    expect(updateDue(listInsertedPacks()[0], Date.now() + PACK_UPDATE_INTERVAL_MS)).toBe(true);
  });

  it('does nothing at all while offline, and leaves the pack due', async () => {
    await seedUnlocked('paid-pack', { version: 'v1' });
    expect(
      await checkPackUpdates({ buildPackId: BUILD, fetchImpl: respond(304), now: NOW, online: false }),
    ).toEqual({});
    expect(calls).toHaveLength(0);
    expect(loadUpdateCheck('paid-pack')).toBeNull();
  });
});

describe('checkPackUpdates — what the endpoint says', () => {
  it('200 with a newer bundle: re-inserts under the same id, keeps progress, tells Home once', async () => {
    await seedUnlocked('paid-pack', { version: 'v1', active: true });
    const before = listInsertedPacks()[0];
    const outcome = await checkPackUpdates({
      buildPackId: BUILD,
      fetchImpl: respond(200, bundle('paid-pack', 7), { etag: '"v2"' }),
      now: NOW,
    });
    expect(outcome).toEqual({ 'paid-pack': 'updated' });

    // New content, same shelf entry, version moved on, origin kept.
    expect((await getInsertedPack('paid-pack'))?.questions).toHaveLength(7);
    const after = listInsertedPacks();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: 'paid-pack',
      questionCount: 7,
      packVersion: 'v2',
      origin: before.origin,
    });
    // Progress, the licence and the active pointer are untouched.
    expect(storage.getItem('quizmill.paid-pack.attempts.v1')).toContain('paid-pack-planets-001');
    expect(storage.getItem(licenceKeyStorageKey('paid-pack'))).toBe(KEY);
    expect(getActivePackPointer()).toBe('paid-pack');
    expect(loadUpdateCheck('paid-pack')).toEqual({ checkedAt: NOW });

    // The beacon, and the one-line notice for Home (the active pack needs a
    // reload to rebind, so the notice says so).
    expect(loadEvents().map((e) => [e.type, e.data])).toEqual([
      ['pack_updated', { pack: 'paid-pack' }],
    ]);
    expect(dispatched).toContain(PACK_UPDATED_EVENT);
    expect(takePackUpdatedNotices()).toEqual([
      { id: 'paid-pack', title: 'Pack paid-pack', count: 7, reload: true },
    ]);
    expect(takePackUpdatedNotices()).toEqual([]);
    // The key is in its own slot only — never in the notice, the event or the entry.
    for (const k of storage.keys()) {
      if (k === licenceKeyStorageKey('paid-pack')) continue;
      expect(storage.getItem(k), k).not.toContain(KEY);
    }
    expect(session.dump()).not.toContain(KEY);
  });

  it('a pack that is not the active one updates silently in storage; no reload asked for', async () => {
    await seedUnlocked('paid-pack', { version: 'v1' });
    await checkPackUpdates({
      buildPackId: BUILD,
      fetchImpl: respond(200, bundle('paid-pack', 5), { etag: '"v2"' }),
      now: NOW,
    });
    expect(getActivePackPointer()).toBeNull();
    expect(takePackUpdatedNotices()).toEqual([
      { id: 'paid-pack', title: 'Pack paid-pack', count: 5, reload: false },
    ]);
  });

  it('200 with the same content (a version the device never stored): version noted, nothing announced', async () => {
    await seedUnlocked('paid-pack');
    const outcome = await checkPackUpdates({
      buildPackId: BUILD,
      fetchImpl: respond(200, bundle('paid-pack', 3), { etag: '"v1"' }),
      now: NOW,
    });
    expect(outcome).toEqual({ 'paid-pack': 'unchanged' });
    expect(listInsertedPacks()[0].packVersion).toBe('v1');
    expect(loadEvents()).toEqual([]);
    expect(takePackUpdatedNotices()).toEqual([]);
    expect(dispatched).not.toContain(PACK_UPDATED_EVENT);
  });

  it('200 without an ETag takes the bundle’s own packVersion', async () => {
    await seedUnlocked('paid-pack', { version: 'v1' });
    await checkPackUpdates({
      buildPackId: BUILD,
      fetchImpl: respond(200, bundle('paid-pack', 4, 'abc1234')),
      now: NOW,
    });
    expect(listInsertedPacks()[0].packVersion).toBe('abc1234');
  });

  it('403: nothing visible, and that pack is not asked about again until a key is entered', async () => {
    await seedUnlocked('paid-pack', { version: 'v1' });
    const outcome = await checkPackUpdates({
      buildPackId: BUILD,
      fetchImpl: respond(403, { error: 'This licence key has been revoked.' }),
      now: NOW,
    });
    expect(outcome).toEqual({ 'paid-pack': 'denied' });
    expect(loadUpdateCheck('paid-pack')).toEqual({ checkedAt: NOW, denied: true });
    expect((await getInsertedPack('paid-pack'))?.questions).toHaveLength(3);
    expect(storage.getItem(licenceKeyStorageKey('paid-pack'))).toBe(KEY);
    expect(loadEvents()).toEqual([]);
    expect(takePackUpdatedNotices()).toEqual([]);

    // Days later: still not asked.
    await checkPackUpdates({
      buildPackId: BUILD,
      fetchImpl: respond(304),
      now: NOW + 10 * PACK_UPDATE_INTERVAL_MS,
    });
    expect(calls).toHaveLength(1);

    // A key entered again (the unlock flow) lifts the stop — and counts as
    // today's look, so the fresh bundle is not asked about again at once.
    const unlocked = await unlockPack(KEY, {
      config: { unlockUrl: DEFAULT_UNLOCK_URL },
      buildPackId: BUILD,
      fetchImpl: respond(200, bundle('paid-pack', 3), { etag: '"v3"' }),
    });
    expect(unlocked.ok).toBe(true);
    expect(loadUpdateCheck('paid-pack')).toEqual({ checkedAt: expect.any(Number) });
    expect(listInsertedPacks()[0]).toMatchObject({ packVersion: 'v3', unlockUrl: DEFAULT_UNLOCK_URL });
    expect(updateDue(listInsertedPacks()[0], Date.now())).toBe(false);
    expect(updateDue(listInsertedPacks()[0], Date.now() + PACK_UPDATE_INTERVAL_MS)).toBe(true);
  });

  it('a pack ejected while the endpoint was still answering stays ejected', async () => {
    await seedUnlocked('paid-pack', { version: 'v1' });
    let release!: () => void;
    const slow = ((input: RequestInfo | URL) =>
      new Promise<Response>((resolve) => {
        calls.push({ url: String(input) });
        release = () =>
          resolve(
            new Response(JSON.stringify(bundle('paid-pack', 7)), {
              status: 200,
              headers: { 'content-type': 'application/json', etag: '"v2"' },
            }),
          );
      })) as typeof fetch;
    const sweep = checkPackUpdates({ buildPackId: BUILD, fetchImpl: slow, now: NOW });
    expect(calls).toHaveLength(1);
    await ejectPack('paid-pack');
    release();
    expect(await sweep).toEqual({ 'paid-pack': 'ejected' });

    expect(await getInsertedPack('paid-pack')).toBeNull();
    expect(listInsertedPacks()).toEqual([]);
    expect(loadUpdateCheck('paid-pack')).toBeNull();
    expect(loadEvents()).toEqual([]);
    expect(takePackUpdatedNotices()).toEqual([]);
    // Progress and the key wait for a re-insert, as after any eject.
    expect(storage.getItem('quizmill.paid-pack.attempts.v1')).toContain('paid-pack-planets-001');
    expect(storage.getItem(licenceKeyStorageKey('paid-pack'))).toBe(KEY);
  });

  it('404 (the key opens another pack now) is treated like a refusal', async () => {
    await seedUnlocked('paid-pack', { version: 'v1' });
    expect(
      await checkPackUpdates({ buildPackId: BUILD, fetchImpl: respond(404, { error: 'no' }), now: NOW }),
    ).toEqual({ 'paid-pack': 'denied' });
    expect(loadUpdateCheck('paid-pack')).toEqual({ checkedAt: NOW, denied: true });
  });

  it('a network failure is silent and leaves the pack due for the next open', async () => {
    await seedUnlocked('paid-pack', { version: 'v1' });
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await checkPackUpdates({ buildPackId: BUILD, fetchImpl: offline, now: NOW })).toEqual({
      'paid-pack': 'offline',
    });
    expect(loadUpdateCheck('paid-pack')).toBeNull();
    expect(loadEvents()).toEqual([]);
  });

  it('a bundle for another pack, a broken bundle or an odd status changes nothing (but counts as checked)', async () => {
    await seedUnlocked('paid-pack', { version: 'v1' });
    for (const fetchImpl of [
      respond(200, bundle('some-other-pack', 9), { etag: '"v2"' }),
      respond(200, { hello: 'world' }),
      respond(500),
    ]) {
      storage.removeItem('quizmill.paid-pack.packUpdate.v1');
      expect(await checkPackUpdates({ buildPackId: BUILD, fetchImpl, now: NOW })).toEqual({
        'paid-pack': 'error',
      });
      expect(loadUpdateCheck('paid-pack')).toEqual({ checkedAt: NOW });
    }
    const broken = bundle('paid-pack', 4);
    broken.questions[0].correctKey = 'Z';
    storage.removeItem('quizmill.paid-pack.packUpdate.v1');
    expect(
      await checkPackUpdates({ buildPackId: BUILD, fetchImpl: respond(200, broken, { etag: '"v2"' }), now: NOW }),
    ).toEqual({ 'paid-pack': 'error' });
    expect((await getInsertedPack('paid-pack'))?.questions).toHaveLength(3);
    expect(listInsertedPacks()).toHaveLength(1);
    expect(listInsertedPacks()[0].packVersion).toBe('v1');
    expect(loadEvents()).toEqual([]);
  });
});

describe('the updated notice', () => {
  it('accumulates per pack and is read exactly once', () => {
    stashPackUpdatedNotice({ id: 'a', title: 'A', count: 1, reload: false });
    stashPackUpdatedNotice({ id: 'b', title: 'B', count: 2, reload: true });
    stashPackUpdatedNotice({ id: 'a', title: 'A', count: 3, reload: false }); // replaces a's line
    expect(takePackUpdatedNotices()).toEqual([
      { id: 'b', title: 'B', count: 2, reload: true },
      { id: 'a', title: 'A', count: 3, reload: false },
    ]);
    expect(takePackUpdatedNotices()).toEqual([]);
  });
});
