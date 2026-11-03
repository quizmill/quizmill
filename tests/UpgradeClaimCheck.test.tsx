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
import { UpgradeClaimCheck, watchUpgradeClaims } from '@/components/UpgradeClaimCheck';
import { insertedPackKey } from '@/lib/packKeys';
import { CLAIM_POLL_MS, CLAIM_WINDOW_MS, readClaims, startClaim } from '@/lib/upgradeClaim';
import { openUnlockedPack, unlockPack } from '@/lib/unlock';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

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
  pathname = '/';
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
  it('still collects claims on the installed app unlock route', async () => {
    pathname = '/unlock/';
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    startClaim(PACK, UPGRADE);
    status = 'paid';
    await mount();
    await advance(0);
    expect(openUnlockedPack).toHaveBeenCalledWith(ENTRY);
    expect(readClaims(PACK).claims).toEqual([]);
  });

  it('cancels an outstanding check when entering browser unlock and resumes on leaving', async () => {
    startClaim(PACK, UPGRADE);
    let release: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    await mount();
    pathname = '/unlock/';
    await act(async () => { root!.render(<UpgradeClaimCheck />); });
    await act(async () => {
      release?.(new Response(JSON.stringify({ status: 'paid', key: 'QM-PAID-KEY' })));
    });
    expect(unlockPack).not.toHaveBeenCalled();
    expect(readClaims(PACK).claims).toHaveLength(1);
    pathname = '/';
    status = 'paid';
    await act(async () => { root!.render(<UpgradeClaimCheck />); });
    await advance(0);
    expect(openUnlockedPack).toHaveBeenCalledWith(ENTRY);
  });

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

  it('a paid key the unlock service answers 503 for stays claimed, to retry', async () => {
    startClaim(PACK, UPGRADE);
    status = 'paid';
    vi.mocked(unlockPack).mockResolvedValueOnce({
      ok: false,
      reason: 'bad-response',
      message: 'The unlock service answered HTTP 503 — try again later.',
    });
    await mount();
    await advance(0);
    expect(unlockPack).toHaveBeenCalledTimes(1);
    expect(openUnlockedPack).not.toHaveBeenCalled();
    expect(readClaims(PACK).claims).toHaveLength(1);
    // The next check gets the key in.
    await advance(CLAIM_POLL_MS);
    expect(openUnlockedPack).toHaveBeenCalledWith(ENTRY);
    expect(readClaims(PACK).claims).toEqual([]);
  });

  it('a tap during a check never leaves two polling loops running', async () => {
    startClaim(PACK, UPGRADE);
    // The first check is slow (1 s), later ones quick: the tap's timer and
    // the slow check's follow-up then land far enough apart to both run.
    const answer = fetchMock.getMockImplementation() as (...args: unknown[]) => Promise<Response>;
    let first = true;
    fetchMock.mockImplementation((...args: unknown[]) => {
      const delay = first ? 1000 : 10;
      first = false;
      return new Promise((resolve) => setTimeout(() => resolve(answer(...args)), delay));
    });
    await mount();
    await advance(100);
    watchUpgradeClaims(); // the tap, while the first check is out
    await advance(30_000);
    // One loop: a check every 3 s, not two interleaved ones.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(30_000 / CLAIM_POLL_MS + 1);
    setVisibility('hidden');
    const calls = fetchMock.mock.calls.length;
    await advance(CLAIM_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it('hiding the app cancels a check that is out: no unlock, claims kept', async () => {
    startClaim(PACK, UPGRADE);
    status = 'paid';
    let seen: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((resolve, reject) => {
          seen = init?.signal ?? undefined;
          const t = setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify({ status: 'paid', key: 'QM-PAID-KEY' }), {
                  status: 200,
                }),
              ),
            1000,
          );
          seen?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    await mount();
    await advance(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    expect(seen?.aborted).toBe(true);
    await advance(CLAIM_POLL_MS * 3);
    expect(unlockPack).not.toHaveBeenCalled();
    expect(openUnlockedPack).not.toHaveBeenCalled();
    expect(readClaims(PACK)).toEqual({ claims: [expect.objectContaining({ url: UPGRADE.url })] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
