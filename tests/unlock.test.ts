/**
 * Unlocking a pack with a licence key (src/lib/unlock.ts): the fragment
 * parser, the request the contract describes, every endpoint outcome,
 * and — above all — that the key goes nowhere but the request, the
 * per-pack licence slot and the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_UNLOCK_URL,
  UNLOCKED_TOAST_KEY,
  fetchUnlockBundle,
  licenceKeyStorageKey,
  readKeyFromHash,
  resolveUnlockConfig,
  stashUnlockedToast,
  stripKeyFromLocation,
  takeUnlockedToast,
  unlockEndpoint,
  unlockPack,
  type UnlockConfig,
} from '@/lib/unlock';
import { getActivePackPointer, getInsertedPack, listInsertedPacks } from '@/lib/packLibrary';
import { loadEvents } from '@/lib/storage';

/** A sampler that hints at the pack its keys open, on the author's own endpoint. */
const CONFIG: UnlockConfig = {
  packId: 'solar-system-full',
  unlockUrl: 'https://unlock.example.com',
};
/** Any other pack: no hint — the key alone says which pack. */
const NO_HINT: UnlockConfig = { unlockUrl: 'https://unlock.example.com' };
const KEY = 'QM-7F3A-TEST-KEY';

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

/** A minimal valid v2 bundle for the pack the key unlocks. */
function bundle(id = CONFIG.packId) {
  const question = (n: number) => ({
    id: `${id}-planets-00${n}`,
    categoryKey: 'planets',
    difficulty: 1,
    prompt: `Unlocked question ${n}: which planet is the largest?`,
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
    manifest: {
      schemaVersion: 2,
      id,
      title: 'Solar System — Full Course',
      description: 'The fuller edition a licence key unlocks.',
      homeSubtitle: 'Every planet, every moon.',
      themeColor: '#123456',
      categories: [{ key: 'planets', label: 'Planets' }],
    },
    questions: [question(1), question(2), question(3)],
  };
}

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];
let storage: ReturnType<typeof fakeStorage>;

function respond(status: number, body: unknown): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  storage = fakeStorage();
  vi.stubGlobal('window', {
    localStorage: storage,
    sessionStorage: fakeStorage(),
    dispatchEvent: () => true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readKeyFromHash', () => {
  it('reads #key=… and decodes it', () => {
    expect(readKeyFromHash('#key=ABC-123')).toBe('ABC-123');
    expect(readKeyFromHash('#utm=x&key=a%20b')).toBe('a b');
    expect(readKeyFromHash('#key=%20padded%20')).toBe('padded');
  });

  it('is null for no key, an empty key, or an unrelated fragment', () => {
    expect(readKeyFromHash('')).toBeNull();
    expect(readKeyFromHash('#key=')).toBeNull();
    expect(readKeyFromHash('#pack=eyJ9')).toBeNull();
    expect(readKeyFromHash('?key=in-the-query-string')).toBeNull();
  });
});

describe('stripKeyFromLocation', () => {
  function locate(search: string, hash: string) {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      localStorage: storage,
      sessionStorage: fakeStorage(),
      dispatchEvent: () => true,
      location: { pathname: '/unlock/', search, hash },
      history: { replaceState },
    });
    return replaceState;
  }

  it('drops the fragment', () => {
    const replaceState = locate('', '#key=ABC');
    stripKeyFromLocation();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/unlock/');
  });

  it('scrubs a query-string key too — never honoured, but not left in the address bar either', () => {
    const replaceState = locate('?key=SECRET', '');
    stripKeyFromLocation();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/unlock/');
    // Other parameters survive; only `key` goes.
    const kept = locate('?utm=x&key=SECRET&b=2', '#key=ALSO');
    stripKeyFromLocation();
    expect(kept).toHaveBeenCalledWith(null, '', '/unlock/?utm=x&b=2');
  });

  it('does nothing when there is nothing to scrub', () => {
    const replaceState = locate('?utm=x', '');
    stripKeyFromLocation();
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('resolveUnlockConfig', () => {
  it('is never null: the hosted default when the pack and the build say nothing', () => {
    expect(resolveUnlockConfig(undefined, undefined)).toEqual({ unlockUrl: DEFAULT_UNLOCK_URL });
    expect(resolveUnlockConfig({}, '')).toEqual({ unlockUrl: DEFAULT_UNLOCK_URL });
    expect(resolveUnlockConfig({ packId: undefined, unlockUrl: undefined }, '  ')).toEqual({
      unlockUrl: DEFAULT_UNLOCK_URL,
    });
    expect(DEFAULT_UNLOCK_URL).toBe('https://sync.quizmill.dev');
  });

  it('the build’s NEXT_PUBLIC_UNLOCK_URL beats the default; the pack’s unlockUrl beats both', () => {
    expect(resolveUnlockConfig(undefined, 'https://unlock.build.test')).toEqual({
      unlockUrl: 'https://unlock.build.test',
    });
    expect(
      resolveUnlockConfig({ unlockUrl: 'https://author.test' }, 'https://unlock.build.test'),
    ).toEqual({ unlockUrl: 'https://author.test' });
  });

  it('carries the pack hint only when the manifest gives one', () => {
    expect(resolveUnlockConfig({ packId: 'solar-system-full' }, undefined)).toEqual({
      unlockUrl: DEFAULT_UNLOCK_URL,
      packId: 'solar-system-full',
    });
    expect(resolveUnlockConfig({ unlockUrl: 'https://author.test' }, undefined)).not.toHaveProperty(
      'packId',
    );
  });
});

describe('unlockEndpoint', () => {
  it('builds GET <base>/v1/unlock?key= with the key encoded — no pack without a hint', () => {
    expect(unlockEndpoint(NO_HINT, 'a b&c')).toBe('https://unlock.example.com/v1/unlock?key=a+b%26c');
    // A trailing slash or a path on the base is fine either way.
    expect(unlockEndpoint({ unlockUrl: 'https://x.test/api/' }, 'k')).toBe(
      'https://x.test/api/v1/unlock?key=k',
    );
    expect(unlockEndpoint({ unlockUrl: 'https://x.test/api' }, 'k')).toBe(
      'https://x.test/api/v1/unlock?key=k',
    );
  });

  it('adds &pack= when the manifest hints at the pack the key should open', () => {
    expect(unlockEndpoint(CONFIG, 'a b&c')).toBe(
      'https://unlock.example.com/v1/unlock?key=a+b%26c&pack=solar-system-full',
    );
  });
});

describe('fetchUnlockBundle', () => {
  it('sends no cookies and returns the bundle on 200', async () => {
    const r = await fetchUnlockBundle(CONFIG, KEY, respond(200, bundle()));
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe(unlockEndpoint(CONFIG, KEY));
    expect(calls[0].init?.credentials).toBe('omit');
  });

  it('shows the endpoint’s refusal text on 403, or a generic line when it is unusable', async () => {
    const denied = await fetchUnlockBundle(
      CONFIG,
      KEY,
      respond(403, { error: 'This key has been used on too many devices.' }),
    );
    expect(denied).toEqual({
      ok: false,
      reason: 'denied',
      message: 'This key has been used on too many devices.',
    });
    for (const body of [undefined, { error: 42 }, { error: 'x'.repeat(500) }, 'nope']) {
      const r = await fetchUnlockBundle(CONFIG, KEY, respond(403, body));
      expect(r).toEqual({ ok: false, reason: 'denied', message: 'That licence key was not accepted.' });
    }
  });

  it('maps 404, other statuses, non-bundles and network failures to reasons', async () => {
    expect((await fetchUnlockBundle(CONFIG, KEY, respond(404, undefined))).ok).toBe(false);
    // With a pack hint, 404 means "this key does not open that pack".
    expect(await fetchUnlockBundle(CONFIG, KEY, respond(404, undefined))).toMatchObject({
      reason: 'unknown-pack',
      message: expect.stringContaining('does not open the pack'),
    });
    expect(await fetchUnlockBundle(NO_HINT, KEY, respond(404, undefined))).toMatchObject({
      reason: 'unknown-pack',
      message: 'The unlock service does not know this pack.',
    });
    expect(await fetchUnlockBundle(CONFIG, KEY, respond(500, undefined))).toMatchObject({
      reason: 'bad-response',
      message: expect.stringContaining('HTTP 500'),
    });
    expect(await fetchUnlockBundle(CONFIG, KEY, respond(200, { hello: 'world' }))).toMatchObject({
      reason: 'bad-response',
    });
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await fetchUnlockBundle(CONFIG, KEY, offline)).toMatchObject({
      reason: 'offline',
      message: expect.stringContaining('connection'),
    });
  });
});

describe('unlockPack', () => {
  it('inserts, activates, keeps the key under the pack and records pack_unlocked', async () => {
    const r = await unlockPack(KEY, {
      config: CONFIG,
      buildPackId: 'solar-system-demo',
      fetchImpl: respond(200, bundle()),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.id).toBe('solar-system-full');
    expect(r.entry.questionCount).toBe(3);
    expect(r.entry.origin).toBe('licence key · unlock.example.com');

    expect(getInsertedPack('solar-system-full')?.questions).toHaveLength(3);
    expect(listInsertedPacks().map((e) => e.id)).toEqual(['solar-system-full']);
    expect(getActivePackPointer()).toBe('solar-system-full');
    expect(storage.getItem(licenceKeyStorageKey('solar-system-full'))).toBe(KEY);

    const events = loadEvents();
    expect(events.map((e) => [e.type, e.data])).toEqual([
      ['pack_unlocked', { pack: 'solar-system-full' }],
    ]);
  });

  it('the key appears nowhere in storage but its own slot', async () => {
    await unlockPack(KEY, {
      config: CONFIG,
      buildPackId: 'solar-system-demo',
      fetchImpl: respond(200, bundle()),
    });
    for (const k of storage.keys()) {
      if (k === licenceKeyStorageKey('solar-system-full')) continue;
      expect(storage.getItem(k), k).not.toContain(KEY);
    }
  });

  it('on a refusal records unlock_failed with the reason only, stores nothing', async () => {
    const r = await unlockPack(KEY, {
      config: CONFIG,
      buildPackId: 'solar-system-demo',
      fetchImpl: respond(403, { error: 'Key revoked.' }),
    });
    expect(r).toEqual({ ok: false, reason: 'denied', message: 'Key revoked.' });
    expect(listInsertedPacks()).toEqual([]);
    expect(getActivePackPointer()).toBeNull();
    expect(storage.getItem(licenceKeyStorageKey('solar-system-full'))).toBeNull();
    const events = loadEvents();
    expect(events.map((e) => [e.type, e.data])).toEqual([
      ['unlock_failed', { pack: 'solar-system-full', reason: 'denied' }],
    ]);
    expect(storage.dump()).not.toContain(KEY);
  });

  it('a bundle that fails validation is refused with its errors', async () => {
    const broken = bundle();
    broken.questions[0].correctKey = 'Z';
    const r = await unlockPack(KEY, {
      config: CONFIG,
      buildPackId: 'solar-system-demo',
      fetchImpl: respond(200, broken),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid-pack');
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(listInsertedPacks()).toEqual([]);
    expect(loadEvents().map((e) => e.data)).toEqual([
      { pack: 'solar-system-full', reason: 'invalid-pack' },
    ]);
  });

  it('without a hint, the key alone says which pack: the bundle’s manifest id is taken as is', async () => {
    const r = await unlockPack(KEY, {
      config: NO_HINT,
      buildPackId: 'solar-system-demo',
      fetchImpl: respond(200, bundle('some-private-pack')),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.id).toBe('some-private-pack');
    expect(calls[0].url).toBe('https://unlock.example.com/v1/unlock?key=QM-7F3A-TEST-KEY');
    expect(getActivePackPointer()).toBe('some-private-pack');
    expect(storage.getItem(licenceKeyStorageKey('some-private-pack'))).toBe(KEY);
    expect(loadEvents().map((e) => [e.type, e.data])).toEqual([
      ['pack_unlocked', { pack: 'some-private-pack' }],
    ]);
  });

  it('without a hint, a refusal names no pack — the event carries the reason only', async () => {
    const r = await unlockPack(KEY, {
      config: NO_HINT,
      buildPackId: 'solar-system-demo',
      fetchImpl: respond(403, { error: 'Key revoked.' }),
    });
    expect(r).toEqual({ ok: false, reason: 'denied', message: 'Key revoked.' });
    expect(loadEvents().map((e) => [e.type, e.data])).toEqual([
      ['unlock_failed', { reason: 'denied' }],
    ]);
    expect(storage.dump()).not.toContain(KEY);
  });

  it('without a hint, a bundle that fails validation is filed under the pack it claimed to be', async () => {
    const broken = bundle('some-private-pack');
    broken.questions[0].correctKey = 'Z';
    const r = await unlockPack(KEY, {
      config: NO_HINT,
      buildPackId: 'solar-system-demo',
      fetchImpl: respond(200, broken),
    });
    expect(r).toMatchObject({ ok: false, reason: 'invalid-pack' });
    expect(listInsertedPacks()).toEqual([]);
    expect(loadEvents().map((e) => [e.type, e.data])).toEqual([
      ['unlock_failed', { pack: 'some-private-pack', reason: 'invalid-pack' }],
    ]);
  });

  it('with a hint, refuses a bundle whose manifest id is another pack — before anything is stored', async () => {
    const r = await unlockPack(KEY, {
      config: CONFIG,
      buildPackId: 'solar-system-demo',
      fetchImpl: respond(200, bundle('some-other-pack')),
    });
    expect(r).toEqual({
      ok: false,
      reason: 'wrong-pack',
      message: 'The unlock service sent a different pack than this key is for.',
    });
    expect(listInsertedPacks()).toEqual([]);
    expect(getActivePackPointer()).toBeNull();
    expect(storage.dump()).not.toContain(KEY);
    expect(loadEvents().map((e) => [e.type, e.data])).toEqual([
      ['unlock_failed', { pack: 'solar-system-full', reason: 'wrong-pack' }],
    ]);
  });

  it('a request abandoned before the bundle arrives stores nothing and records nothing', async () => {
    const controller = new AbortController();
    // The endpoint answers only after the caller has given up on it.
    const late = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      controller.abort();
      return new Response(JSON.stringify(bundle()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const r = await unlockPack(KEY, {
      config: CONFIG,
      buildPackId: 'solar-system-demo',
      fetchImpl: late,
      signal: controller.signal,
    });
    expect(r).toEqual({ ok: false, reason: 'cancelled', message: '' });
    expect(calls[0].init?.signal).toBe(controller.signal);
    expect(listInsertedPacks()).toEqual([]);
    expect(getActivePackPointer()).toBeNull();
    expect(storage.getItem(licenceKeyStorageKey('solar-system-full'))).toBeNull();
    expect(loadEvents()).toEqual([]);
  });

  it('a fetch the signal aborted mid-flight is cancelled, not "offline"', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      throw init?.signal?.reason ?? new DOMException('aborted', 'AbortError');
    }) as typeof fetch;
    const r = await unlockPack(KEY, {
      config: CONFIG,
      buildPackId: 'solar-system-demo',
      fetchImpl: aborted,
      signal: controller.signal,
    });
    expect(r).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(loadEvents()).toEqual([]);
  });

  it('refuses the pack built into this app, like any insert', async () => {
    const r = await unlockPack(KEY, {
      config: CONFIG,
      buildPackId: 'solar-system-full',
      fetchImpl: respond(200, bundle()),
    });
    expect(r.ok).toBe(false);
    expect(getActivePackPointer()).toBeNull();
  });
});

describe('the unlocked toast', () => {
  it('is stashed for Home and read exactly once', () => {
    expect(takeUnlockedToast()).toBeNull();
    stashUnlockedToast({ title: 'Full Course', count: 3 });
    expect(window.sessionStorage.getItem(UNLOCKED_TOAST_KEY)).toContain('Full Course');
    expect(takeUnlockedToast()).toEqual({ title: 'Full Course', count: 3 });
    expect(takeUnlockedToast()).toBeNull();
  });
});
