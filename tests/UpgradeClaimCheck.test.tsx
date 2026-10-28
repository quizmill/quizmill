// @vitest-environment happy-dom
/**
 * The collecting half of the upgrade claim hand-off: with a claim pending,
 * the layout's UpgradeClaimCheck asks the upgrade url at start, then every
 * 3 s for a minute, never while hidden, again on becoming visible — and a
 * paid key goes through the ordinary unlock, which ends on Home.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UpgradeClaimCheck } from '@/components/UpgradeClaimCheck';
import { insertedPackKey } from '@/lib/packKeys';
import { CLAIM_POLL_MS, CLAIM_WINDOW_MS, readClaims, startClaim } from '@/lib/upgradeClaim';
import { openUnlockedPack, unlockPack } from '@/lib/unlock';

const UPGRADE = {
  title: 'Get the full course',
  url: 'https://shop.test/course',
  packId: 'solar-system-full',
  unlockUrl: 'https://unlock.test',
};

vi.mock('@/config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/config')>();
  return {
    ...mod,
    APP_CONFIG: {
      ...mod.APP_CONFIG,
      upgrade: {
        title: 'Get the full course',
        url: 'https://shop.test/course',
        packId: 'solar-system-full',
        unlockUrl: 'https://unlock.test',
      },
    },
  };
});

const ENTRY = { id: 'solar-system-full', title: 'Full', questionCount: 7 };
vi.mock('@/lib/unlock', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/unlock')>();
  return {
    ...mod,
    unlockPack: vi.fn(async () => ({ ok: true, entry: ENTRY })),
    openUnlockedPack: vi.fn(),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACK = 'solar-system-demo';
let status: 'pending' | 'paid' = 'pending';
let fetchMock: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState = 'visible';
let container: HTMLDivElement;
let root: Root | undefined;

function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

async function mount() {
  await act(async () => {
    root = createRoot(container);
    root.render(<UpgradeClaimCheck />);
  });
}

/** Let timers and the fetch promises behind them run. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  localStorage.clear();
  status = 'pending';
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
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

describe('UpgradeClaimCheck', () => {
  it('asks nothing when no claim is pending', async () => {
    await mount();
    await advance(CLAIM_WINDOW_MS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks at start, every 3 s for a minute, then rests until visible again', async () => {
    startClaim(PACK, UPGRADE);
    await mount();
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(UPGRADE.url);
    await advance(CLAIM_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(CLAIM_WINDOW_MS);
    const afterWindow = fetchMock.mock.calls.length;
    expect(afterWindow).toBe(CLAIM_WINDOW_MS / CLAIM_POLL_MS);
    await advance(CLAIM_WINDOW_MS);
    expect(fetchMock).toHaveBeenCalledTimes(afterWindow);

    // Hidden: nothing. Visible again: at once, then the next window.
    setVisibility('hidden');
    await advance(CLAIM_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(afterWindow);
    setVisibility('visible');
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(afterWindow + 1);
    setVisibility('hidden');
    await advance(CLAIM_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(afterWindow + 1);
  });

  it('pending → paid: unlocks once with the key, ends on Home, deletes the claim', async () => {
    startClaim(PACK, UPGRADE);
    await mount();
    await advance(CLAIM_POLL_MS);
    expect(unlockPack).not.toHaveBeenCalled();

    status = 'paid';
    await advance(CLAIM_POLL_MS);
    expect(unlockPack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unlockPack).mock.calls[0][0]).toBe('QM-PAID-KEY');
    expect(vi.mocked(unlockPack).mock.calls[0][1].config).toEqual({
      unlockUrl: 'https://unlock.test',
      packId: 'solar-system-full',
    });
    expect(openUnlockedPack).toHaveBeenCalledWith(ENTRY);
    expect(readClaims(PACK).claims).toEqual([]);

    const calls = fetchMock.mock.calls.length;
    await advance(CLAIM_WINDOW_MS);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(unlockPack).toHaveBeenCalledTimes(1);
  });

  it('leaves a pack that is already unlocked alone', async () => {
    startClaim(PACK, UPGRADE);
    localStorage.setItem(insertedPackKey('solar-system-full'), '{}');
    await mount();
    await advance(CLAIM_POLL_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(unlockPack).not.toHaveBeenCalled();
    expect(readClaims(PACK).claims).toEqual([]);
  });
});
