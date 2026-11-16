// @vitest-environment happy-dom
/**
 * The upgrade claim hand-off when a sample's purchase opens its OWN pack
 * id (`upgrade.packId` = the pack's id: one id, a built-in edition and a
 * fuller one a licence key fetches). "Already unlocked?" can no longer be
 * "is something stored under that id" — the sample itself may be what is
 * stored there (inserted from the registry into another app). Only the
 * edition a licence key fetched counts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UpgradeClaimCheck } from '@/components/UpgradeClaimCheck';
import { insertedPackKey, LIBRARY_INDEX_KEY } from '@/lib/packKeys';
import { CLAIM_POLL_MS, readClaims, startClaim } from '@/lib/upgradeClaim';
import { openUnlockedPack, unlockPack } from '@/lib/unlock';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const PACK = 'solar-system-demo';
const UPGRADE = {
  title: 'Get the full bank',
  url: 'https://shop.test/full',
  packId: PACK,
  unlockUrl: 'https://unlock.test',
};

vi.mock('@/config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/config')>();
  return {
    ...mod,
    APP_CONFIG: {
      ...mod.APP_CONFIG,
      upgrade: {
        title: 'Get the full bank',
        url: 'https://shop.test/full',
        packId: 'solar-system-demo',
        unlockUrl: 'https://unlock.test',
      },
    },
  };
});

vi.mock('@/lib/unlock', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/unlock')>();
  return {
    ...mod,
    unlockPack: vi.fn(async () => ({
      ok: true,
      entry: { id: 'solar-system-demo', title: 'Full', questionCount: 7 },
    })),
    openUnlockedPack: vi.fn(),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let status: 'pending' | 'paid' = 'pending';
let fetchMock: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root | undefined;

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<UpgradeClaimCheck />);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Something stored under the pack's id, with or without the mark of a
 *  licence key (the endpoint that served it). */
function storeUnderOwnId(unlockUrl?: string) {
  localStorage.setItem(insertedPackKey(PACK), '{}');
  localStorage.setItem(
    LIBRARY_INDEX_KEY,
    JSON.stringify([{ id: PACK, title: 'x', ...(unlockUrl ? { unlockUrl } : {}) }]),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  localStorage.clear();
  status = 'pending';
  fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify(status === 'paid' ? { status, key: 'QM-PAID-KEY' } : { status }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(unlockPack).mockClear();
  vi.mocked(openUnlockedPack).mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('UpgradeClaimCheck — the purchase opens the pack’s own id', () => {
  it('paid: unlocks with the key, asking for that same id', async () => {
    startClaim(PACK, UPGRADE);
    status = 'paid';
    await mount();
    await advance(0);
    expect(unlockPack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unlockPack).mock.calls[0][0]).toBe('QM-PAID-KEY');
    expect(vi.mocked(unlockPack).mock.calls[0][1].config).toEqual({
      unlockUrl: 'https://unlock.test',
      packId: PACK,
    });
    expect(openUnlockedPack).toHaveBeenCalledTimes(1);
    expect(readClaims(PACK).claims).toEqual([]);
  });

  it('the sample merely being stored under the id is not "already unlocked": the claim is still asked about', async () => {
    startClaim(PACK, UPGRADE);
    storeUnderOwnId();
    await mount();
    await advance(CLAIM_POLL_MS);
    expect(fetchMock).toHaveBeenCalled();
    expect(readClaims(PACK).claims).toHaveLength(1);
  });

  it('once a licence key fetched the fuller edition, pending claims are dropped unasked', async () => {
    startClaim(PACK, UPGRADE);
    storeUnderOwnId('https://unlock.test');
    await mount();
    await advance(CLAIM_POLL_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(unlockPack).not.toHaveBeenCalled();
    expect(readClaims(PACK).claims).toEqual([]);
  });
});
