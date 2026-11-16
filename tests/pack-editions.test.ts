/**
 * One pack id, two editions. The app is built from a sample; a licence
 * key fetches the fuller bank under the SAME id (same question ids, more
 * of them) and the app uses it in place of the build-time content from
 * then on. Nothing a learner has done moves, because every store is keyed
 * by that one id — on the device and on the sync server alike.
 *
 * Here: the library, the unlock, the daily update check and removal, all
 * against a fake localStorage and a stubbed endpoint. The boot path
 * itself (which content renders) is in runtime-pack.test.ts and
 * tests/e2e/unlocked-edition.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { insertedPackKey } from '@/lib/packKeys';
import {
  activatePack,
  ejectPack,
  getActivePackPointer,
  getInsertedPack,
  insertPack,
  isActiveLibraryPack,
  listInsertedPacks,
  migrateInsertedPacks,
  packProgress,
  unlockedEntry,
} from '@/lib/packLibrary';
import { readStoredPack } from '@/lib/packStore';
import { PACK_UPDATE_INTERVAL_MS, checkPackUpdates, takePackUpdatedNotices } from '@/lib/packUpdates';
import { DEFAULT_UNLOCK_URL, licenceKeyStorageKey, unlockPack } from '@/lib/unlock';
import { upgradeOnOffer } from '@/lib/upgrade';

/** The pack this "deployment" was built from — the sample. */
const BUILD = 'solar-system-demo';
const KEY = 'QL-7F3A-TEST-KEY1';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    snapshot: (prefix: string) =>
      Object.fromEntries([...map.entries()].filter(([k]) => k.startsWith(prefix))),
  };
}

/** A valid v2 bundle of `n` questions under `id`. */
function bundle(id: string, n: number) {
  return {
    format: 'quizmill-pack-bundle',
    manifest: {
      schemaVersion: 2,
      id,
      title: `Pack ${id}`,
      description: 'The fuller edition a licence key unlocks.',
      homeSubtitle: 'Every planet, every moon.',
      themeColor: '#123456',
      categories: [{ key: 'planets', label: 'Planets' }],
    },
    questions: Array.from({ length: n }, (_, i) => ({
      id: `${id}-planets-${String(i + 1).padStart(3, '0')}`,
      categoryKey: 'planets',
      difficulty: 1,
      prompt: `Question ${i + 1}: which planet is the largest?`,
      options: [
        { key: 'A', text: 'Jupiter' },
        { key: 'B', text: 'Mars' },
      ],
      correctKey: 'A',
      explanation: 'Jupiter is the largest planet in the solar system by far.',
      source: 'original',
      reviewStatus: 'draft',
    })),
  };
}

let storage: ReturnType<typeof fakeStorage>;
let calls: string[];

function respond(status: number, body?: unknown, headers: Record<string, string> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as typeof fetch;
}

/** What a learner built up on the sample before unlocking. */
function seedProgress() {
  storage.setItem(
    `quizmill.${BUILD}.attempts.v1`,
    JSON.stringify([
      { id: 'a1', questionId: `${BUILD}-planets-001`, sessionId: 's1', isCorrect: true, answeredAt: 1 },
      { id: 'a2', questionId: `${BUILD}-planets-002`, sessionId: 's1', isCorrect: false, answeredAt: 2 },
    ]),
  );
  storage.setItem(`quizmill.${BUILD}.sessions.v1`, JSON.stringify([{ id: 's1', startedAt: 1 }]));
  storage.setItem(
    `quizmill.${BUILD}.notes.v1`,
    JSON.stringify([{ questionId: `${BUILD}-planets-002`, text: 'gas giants', updatedAt: 3 }]),
  );
  storage.setItem(
    `quizmill.${BUILD}.achievements.v1`,
    JSON.stringify([{ id: 'first-round', earnedAt: 4 }]),
  );
}

/** Unlock the built-in pack's fuller edition, as the key entries do. */
async function unlock(n = 7, etag = '"v1"') {
  return unlockPack(KEY, {
    config: { unlockUrl: DEFAULT_UNLOCK_URL },
    buildPackId: BUILD,
    fetchImpl: respond(200, bundle(BUILD, n), { etag }),
  });
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

describe('unlocking a pack that shares the built-in pack’s id', () => {
  it('stores it as the unlocked edition: more questions, every attempt, note and sticker where it was', async () => {
    seedProgress();
    const before = storage.snapshot(`quizmill.${BUILD}.`);

    const outcome = await unlock(7);
    expect(outcome).toMatchObject({ ok: true, entry: { id: BUILD, questionCount: 7 } });

    // One shelf entry, under the one id, marked as arrived by licence key.
    expect(listInsertedPacks().map((e) => e.id)).toEqual([BUILD]);
    expect(unlockedEntry(BUILD)).toMatchObject({ questionCount: 7, unlockUrl: DEFAULT_UNLOCK_URL });
    expect((await getInsertedPack(BUILD))?.questions).toHaveLength(7);
    expect(isActiveLibraryPack(BUILD, BUILD)).toBe(true);

    // Progress did not move: same keys, same bytes.
    for (const [key, value] of Object.entries(before)) expect(storage.getItem(key), key).toBe(value);
    expect(packProgress(BUILD)).toMatchObject({ sessions: 1, attempts: 2 });
    expect(storage.getItem(licenceKeyStorageKey(BUILD))).toBe(KEY);
  });

  it('works when the manifest names its own id as the pack the key opens', async () => {
    const outcome = await unlockPack(KEY, {
      config: { unlockUrl: 'https://author.test', packId: BUILD },
      buildPackId: BUILD,
      fetchImpl: respond(200, bundle(BUILD, 5)),
    });
    expect(outcome.ok).toBe(true);
    expect(calls).toEqual([`https://author.test/v1/unlock?key=${KEY}&pack=${BUILD}`]);
    expect(unlockedEntry(BUILD)?.questionCount).toBe(5);
  });

  it('still refuses the same id from a plain file or URL — before and after unlocking', async () => {
    const refused = await insertPack(bundle(BUILD, 9), { origin: 'full.bundle.json', buildPackId: BUILD });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors[0]).toContain('built into this app');
    expect(listInsertedPacks()).toEqual([]);

    // `unlocked` alone is not a pass either: it takes the endpoint that served it.
    expect((await insertPack(bundle(BUILD, 9), { buildPackId: BUILD, unlocked: true })).ok).toBe(false);

    await unlock(7);
    expect((await insertPack(bundle(BUILD, 9), { origin: 'full.bundle.json', buildPackId: BUILD })).ok).toBe(false);
    expect((await getInsertedPack(BUILD))?.questions).toHaveLength(7);
    expect(unlockedEntry(BUILD)?.unlockUrl).toBe(DEFAULT_UNLOCK_URL);
  });

  it('is the active pack with or without the pointer, but never over another pack that is pointed at', async () => {
    await unlock(7);
    // The built-in card's "Make active" clears the pointer: still the unlocked edition.
    await activatePack(null, { buildPackId: BUILD });
    expect(getActivePackPointer()).toBeNull();
    expect(isActiveLibraryPack(BUILD, BUILD)).toBe(true);

    await insertPack(bundle('another-pack', 2), { buildPackId: BUILD });
    await activatePack('another-pack', { buildPackId: BUILD });
    expect(isActiveLibraryPack(BUILD, BUILD)).toBe(false);
    expect(isActiveLibraryPack('another-pack', BUILD)).toBe(true);

    // A pointer left at a pack that has gone falls back to it, as the boot path does.
    storage.removeItem('quizmill.packLibrary.pack.another-pack.v1');
    expect(isActiveLibraryPack(BUILD, BUILD)).toBe(true);
  });

  it('a file stored under an id the build later takes is not on screen, even with the pointer at it', async () => {
    // Inserted and made active while another pack was the build-time one…
    expect((await insertPack(bundle(BUILD, 3), { origin: 'old.bundle.json', buildPackId: 'earlier-build' })).ok).toBe(true);
    await activatePack(BUILD, { buildPackId: 'earlier-build' });
    expect(isActiveLibraryPack(BUILD, 'earlier-build')).toBe(true);
    // …then a deploy whose built-in pack has that id: the boot path renders the build.
    expect(isActiveLibraryPack(BUILD, BUILD)).toBe(false);
  });
});

describe('removing the unlocked edition', () => {
  it('leaves the built-in edition, with progress and the key intact', async () => {
    seedProgress();
    await unlock(7);
    const before = storage.snapshot(`quizmill.${BUILD}.`);

    await ejectPack(BUILD, { buildPackId: BUILD });

    expect(listInsertedPacks()).toEqual([]);
    expect(await getInsertedPack(BUILD)).toBeNull();
    expect(unlockedEntry(BUILD)).toBeNull();
    expect(getActivePackPointer()).toBeNull();
    expect(isActiveLibraryPack(BUILD, BUILD)).toBe(false);
    for (const [key, value] of Object.entries(before)) expect(storage.getItem(key), key).toBe(value);

    // The same key brings it back, to the same progress.
    expect((await unlock(7)).ok).toBe(true);
    expect(packProgress(BUILD).attempts).toBe(2);
  });
});

describe('the daily update check, keyed on the shared id', () => {
  it('replaces the unlocked edition’s content, leaves progress alone and asks Home to reload', async () => {
    seedProgress();
    await unlock(7, '"v1"');
    await activatePack(null, { buildPackId: BUILD }); // on screen through the built-in card, no pointer
    const before = storage.snapshot(`quizmill.${BUILD}.attempts`);
    calls = [];

    const outcomes = await checkPackUpdates({
      buildPackId: BUILD,
      fetchImpl: respond(200, bundle(BUILD, 9), { etag: '"v2"' }),
      now: Date.now() + 2 * PACK_UPDATE_INTERVAL_MS,
    });

    expect(outcomes).toEqual({ [BUILD]: 'updated' });
    expect(calls).toEqual([`${DEFAULT_UNLOCK_URL}/v1/unlock?key=${KEY}&pack=${BUILD}`]);
    expect((await getInsertedPack(BUILD))?.questions).toHaveLength(9);
    expect(unlockedEntry(BUILD)).toMatchObject({ questionCount: 9, packVersion: 'v2' });
    expect(storage.snapshot(`quizmill.${BUILD}.attempts`)).toEqual(before);
    expect(takePackUpdatedNotices()).toEqual([
      { id: BUILD, title: `Pack ${BUILD}`, count: 9, reload: true },
    ]);
  });

  it('does not bring back an unlocked edition that was removed', async () => {
    await unlock(7);
    await ejectPack(BUILD, { buildPackId: BUILD });
    const outcomes = await checkPackUpdates({
      buildPackId: BUILD,
      fetchImpl: respond(200, bundle(BUILD, 9), { etag: '"v2"' }),
      now: Date.now() + 2 * PACK_UPDATE_INTERVAL_MS,
    });
    expect(outcomes).toEqual({});
    expect(await getInsertedPack(BUILD)).toBeNull();
  });
});

// With IndexedDB the library keeps only ONE pack's copy in localStorage:
// the one the boot reads. With no other pack pointed at, that is the
// unlocked edition — pointer or no pointer.
describe('the unlocked edition’s boot copy, with packs in IndexedDB', () => {
  const copy = (id: string) => storage.getItem(insertedPackKey(id));
  const copyCount = (id: string) => (JSON.parse(copy(id)!) as { questions: unknown[] }).questions.length;

  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  it('stays in localStorage when no pack is pointed at, through a migration and an update', async () => {
    await unlock(7);
    await activatePack(null, { buildPackId: BUILD });
    expect(getActivePackPointer()).toBeNull();
    expect(copyCount(BUILD)).toBe(7);

    await migrateInsertedPacks(BUILD);
    expect(copyCount(BUILD)).toBe(7);

    await checkPackUpdates({
      buildPackId: BUILD,
      fetchImpl: respond(200, bundle(BUILD, 9), { etag: '"v2"' }),
      now: Date.now() + 2 * PACK_UPDATE_INTERVAL_MS,
    });
    expect(copyCount(BUILD)).toBe(9);
  });

  it('is there straight after the insert, before anything points at it', async () => {
    const inserted = await insertPack(bundle(BUILD, 7), {
      buildPackId: BUILD,
      unlockUrl: DEFAULT_UNLOCK_URL,
      unlocked: true,
    });
    expect(inserted.ok).toBe(true);
    expect(getActivePackPointer()).toBeNull();
    expect(copyCount(BUILD)).toBe(7);
  });

  it('moves out when another pack is opened and back when the app returns to the built-in pack', async () => {
    await unlock(7);
    await activatePack(null, { buildPackId: BUILD });
    await insertPack(bundle('another-pack', 2), { buildPackId: BUILD });
    expect(copy('another-pack')).toBeNull();

    expect(await activatePack('another-pack', { buildPackId: BUILD })).toEqual({ ok: true });
    expect(copy(BUILD)).toBeNull();
    expect(copyCount('another-pack')).toBe(2);
    expect((await getInsertedPack(BUILD))?.questions).toHaveLength(7);

    expect(await activatePack(null, { buildPackId: BUILD })).toEqual({ ok: true });
    expect(copy('another-pack')).toBeNull();
    expect(copyCount(BUILD)).toBe(7);
    expect(isActiveLibraryPack(BUILD, BUILD)).toBe(true);
  });

  it('comes back when the other, active pack is ejected', async () => {
    await unlock(7);
    await insertPack(bundle('another-pack', 2), { buildPackId: BUILD });
    await activatePack('another-pack', { buildPackId: BUILD });
    expect(copy(BUILD)).toBeNull();

    expect(await ejectPack('another-pack', { buildPackId: BUILD })).toEqual({ wasActive: true });
    expect(getActivePackPointer()).toBeNull();
    expect(copyCount(BUILD)).toBe(7);
  });

  it('is put back on the next app open when it has gone missing', async () => {
    await unlock(7);
    await activatePack(null, { buildPackId: BUILD });
    storage.removeItem(insertedPackKey(BUILD));

    await migrateInsertedPacks(BUILD);
    expect(copyCount(BUILD)).toBe(7);
  });

  it('survives the move to IndexedDB of an edition an older build kept in localStorage', async () => {
    // Stored by a build that had no IndexedDB store: unlock without one.
    vi.stubGlobal('indexedDB', undefined);
    await unlock(7);
    await activatePack(null, { buildPackId: BUILD });
    vi.stubGlobal('indexedDB', new IDBFactory());

    await migrateInsertedPacks(BUILD);
    expect(copyCount(BUILD)).toBe(7);
    expect((await readStoredPack(BUILD))?.questions).toHaveLength(7);
  });
});

describe('the upgrade pitch', () => {
  const upgrade = { title: 'Get the full bank', url: 'https://example.com/full', packId: BUILD };

  it('is on offer for the built-in edition and gone once its own unlocked edition is in use', async () => {
    expect(upgradeOnOffer(BUILD, upgrade)).toBe(upgrade);
    await unlock(7);
    expect(upgradeOnOffer(BUILD, upgrade)).toBeUndefined();
    await ejectPack(BUILD, { buildPackId: BUILD });
    expect(upgradeOnOffer(BUILD, upgrade)).toBe(upgrade);
  });

  it('stays for a pack that sells a different id, and for a sample that is merely on the shelf', async () => {
    const other = { ...upgrade, packId: `${BUILD}-full` };
    await unlock(7);
    expect(upgradeOnOffer(BUILD, other)).toBe(other);
    expect(upgradeOnOffer(BUILD, undefined)).toBeUndefined();

    // A sample inserted as a plain pack (no licence key) that names itself.
    await insertPack(bundle('shelf-sample', 3), { buildPackId: BUILD });
    const own = { ...upgrade, packId: 'shelf-sample' };
    expect(upgradeOnOffer('shelf-sample', own)).toBe(own);
  });
});
