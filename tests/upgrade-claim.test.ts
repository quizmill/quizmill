// @vitest-environment happy-dom
/**
 * The upgrade claim hand-off (src/lib/upgradeClaim.ts): a tap on the
 * upgrade card leaves with a fresh `claim=`, and the app — the installed
 * one, whose storage the checkout's browser layer can't reach — asks the
 * upgrade url about it (POST { claim }) until the answer is `paid` with
 * a key, which goes through the ordinary licence-key unlock. Everything
 * runs against a fake fetch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLAIM_MAX,
  CLAIM_TTL_MS,
  checkClaims,
  claimHref,
  claimsStorageKey,
  newClaimId,
  readClaims,
  startClaim,
  type ClaimDeps,
} from '@/lib/upgradeClaim';

const PACK = 'solar-sampler';
const NOW = 1_800_000_000_000;
const UPGRADE = {
  title: 'Get the full course',
  url: 'https://shop.test/course',
  packId: 'solar-system-full',
  unlockUrl: 'https://unlock.test',
};

function answer(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fake fetch answering each claim from a table; records every call. */
function fakeFetch(answers: Record<string, () => Response | Promise<Response>>) {
  const calls: { url: string; init: RequestInit; claim: string }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const claim = JSON.parse(String(init?.body)).claim as string;
    calls.push({ url: String(input), init: init!, claim });
    const respond = answers[claim];
    if (!respond) throw new TypeError('Failed to fetch');
    return respond();
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function deps(over: Partial<ClaimDeps> = {}): ClaimDeps {
  return {
    fetchImpl: fakeFetch({}).impl,
    now: () => NOW,
    isUnlocked: () => false,
    unlock: vi.fn(async () => 'ok' as const),
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('leaving with a claim', () => {
  it('a claim is 32 lowercase hex characters, fresh every time', () => {
    const a = newClaimId();
    const b = newClaimId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('claimHref adds claim= next to the ref, keeping everything else', () => {
    expect(
      claimHref('https://shop.test/course?utm_source=app&ref=solar-sampler-home#pricing', 'abc'),
    ).toBe('https://shop.test/course?utm_source=app&ref=solar-sampler-home&claim=abc#pricing');
  });

  it('startClaim keeps the claim, its target pack, the url and the time', () => {
    const claim = startClaim(PACK, UPGRADE, NOW);
    expect(claim).toMatch(/^[0-9a-f]{32}$/);
    expect(readClaims(PACK).claims).toEqual([
      { claim, packId: 'solar-system-full', url: UPGRADE.url, createdAt: NOW },
    ]);
    // Per pack: another pack's storage is untouched.
    expect(readClaims('other-pack').claims).toEqual([]);
    expect(claimsStorageKey(PACK)).toBe('quizmill.solar-sampler.upgradeClaims.v1');
  });

  it(`keeps at most ${CLAIM_MAX} per pack, dropping the oldest`, () => {
    const made = Array.from({ length: CLAIM_MAX + 2 }, (_, i) => startClaim(PACK, UPGRADE, NOW + i));
    expect(readClaims(PACK).claims.map((c) => c.claim)).toEqual(made.slice(2));
  });
});

describe('coming back: checking the claims', () => {
  it('POSTs { claim } as JSON to the upgrade url', async () => {
    const claim = startClaim(PACK, UPGRADE, NOW)!;
    const fake = fakeFetch({ [claim]: () => answer(200, { status: 'pending' }) });
    const result = await checkClaims(PACK, UPGRADE, deps({ fetchImpl: fake.impl }));
    expect(result).toBe('pending');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(UPGRADE.url);
    expect(fake.calls[0].init.method).toBe('POST');
    expect(fake.calls[0].init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(fake.calls[0].init.body))).toEqual({ claim });
    expect(readClaims(PACK).claims).toHaveLength(1);
  });

  it('pending → paid unlocks once with the key, then deletes the claim', async () => {
    const claim = startClaim(PACK, UPGRADE, NOW)!;
    let status: 'pending' | 'paid' = 'pending';
    const fake = fakeFetch({
      [claim]: () =>
        answer(200, status === 'paid' ? { status, key: 'QM-PAID-KEY' } : { status }),
    });
    const unlock = vi.fn(async () => 'ok' as const);
    const d = deps({ fetchImpl: fake.impl, unlock });

    expect(await checkClaims(PACK, UPGRADE, d)).toBe('pending');
    expect(unlock).not.toHaveBeenCalled();

    status = 'paid';
    expect(await checkClaims(PACK, UPGRADE, d)).toBe('unlocked');
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalledWith('QM-PAID-KEY');
    expect(readClaims(PACK).claims).toEqual([]);

    // Nothing left to ask about.
    expect(await checkClaims(PACK, UPGRADE, d)).toBe('none');
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(fake.calls).toHaveLength(2);
  });

  it('a paid answer whose unlock could not reach the service keeps the claim', async () => {
    const claim = startClaim(PACK, UPGRADE, NOW)!;
    const fake = fakeFetch({ [claim]: () => answer(200, { status: 'paid', key: 'K' }) });
    const d = deps({ fetchImpl: fake.impl, unlock: vi.fn(async () => 'retry' as const) });
    expect(await checkClaims(PACK, UPGRADE, d)).toBe('pending');
    expect(readClaims(PACK).claims).toHaveLength(1);
  });

  it('a paid answer whose key is refused deletes the claim', async () => {
    const claim = startClaim(PACK, UPGRADE, NOW)!;
    const fake = fakeFetch({ [claim]: () => answer(200, { status: 'paid', key: 'K' }) });
    const d = deps({ fetchImpl: fake.impl, unlock: vi.fn(async () => 'failed' as const) });
    expect(await checkClaims(PACK, UPGRADE, d)).toBe('none');
    expect(readClaims(PACK).claims).toEqual([]);
  });

  it('revoked deletes that claim and keeps the others', async () => {
    const gone = startClaim(PACK, UPGRADE, NOW)!;
    const kept = startClaim(PACK, UPGRADE, NOW + 1)!;
    const fake = fakeFetch({
      [gone]: () => answer(200, { status: 'revoked' }),
      [kept]: () => answer(200, { status: 'pending' }),
    });
    expect(await checkClaims(PACK, UPGRADE, deps({ fetchImpl: fake.impl }))).toBe('pending');
    expect(readClaims(PACK).claims.map((c) => c.claim)).toEqual([kept]);
  });

  const notTheProtocol: [string, () => Response | Promise<Response>][] = [
    ['a network or CORS failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a plain checkout page (HTML)', () => new Response('<html>Buy</html>', { status: 200 })],
    ['a 404', () => answer(404, { status: 'pending' })],
    ['JSON without a status', () => answer(200, { ok: true })],
    ['an unknown status', () => answer(200, { status: 'maybe' })],
    ['paid without a key', () => answer(200, { status: 'paid' })],
  ];
  for (const [label, respond] of notTheProtocol) {
    it(`${label} stops claims for that pack on this device`, async () => {
      const a = startClaim(PACK, UPGRADE, NOW)!;
      startClaim(PACK, UPGRADE, NOW + 1);
      startClaim('other-pack', UPGRADE, NOW);
      const fake = fakeFetch({ [a]: respond });
      const unlock = vi.fn(async () => 'ok' as const);
      expect(await checkClaims(PACK, UPGRADE, deps({ fetchImpl: fake.impl, unlock }))).toBe(
        'none',
      );
      // One failed request, nothing more: all claims gone, none asked again.
      expect(fake.calls).toHaveLength(1);
      expect(unlock).not.toHaveBeenCalled();
      expect(readClaims(PACK)).toEqual({ claims: [], off: true });
      // …and the link leaves without a claim from now on.
      expect(startClaim(PACK, UPGRADE, NOW + 2)).toBeNull();
      expect(readClaims(PACK).claims).toEqual([]);
      // Another pack is not affected.
      expect(readClaims('other-pack').claims).toHaveLength(1);
    });
  }

  it('claims older than 48 h are dropped without a check', async () => {
    const old = startClaim(PACK, UPGRADE, NOW - CLAIM_TTL_MS - 1)!;
    const fresh = startClaim(PACK, UPGRADE, NOW - CLAIM_TTL_MS + 60_000)!;
    const fake = fakeFetch({ [fresh]: () => answer(200, { status: 'pending' }) });
    expect(await checkClaims(PACK, UPGRADE, deps({ fetchImpl: fake.impl }))).toBe('pending');
    expect(fake.calls.map((c) => c.claim)).toEqual([fresh]);
    expect(readClaims(PACK).claims.map((c) => c.claim)).toEqual([fresh]);
    expect(old).not.toBe(fresh);

    // All expired → nothing asked, nothing left.
    const later = deps({ fetchImpl: fake.impl, now: () => NOW + CLAIM_TTL_MS });
    expect(await checkClaims(PACK, UPGRADE, later)).toBe('none');
    expect(fake.calls).toHaveLength(1);
    expect(readClaims(PACK).claims).toEqual([]);
  });

  it('an already-unlocked pack is left alone: claims deleted, nothing asked', async () => {
    startClaim(PACK, UPGRADE, NOW);
    const fake = fakeFetch({});
    const unlock = vi.fn(async () => 'ok' as const);
    const d = deps({ fetchImpl: fake.impl, unlock, isUnlocked: () => true });
    expect(await checkClaims(PACK, UPGRADE, d)).toBe('none');
    expect(fake.calls).toHaveLength(0);
    expect(unlock).not.toHaveBeenCalled();
    expect(readClaims(PACK)).toEqual({ claims: [] });
  });

  it('a pack unlocked by hand while the check was out is left alone too', async () => {
    const claim = startClaim(PACK, UPGRADE, NOW)!;
    let unlocked = false;
    const fake = fakeFetch({
      [claim]: () => {
        unlocked = true; // the key was pasted meanwhile
        return answer(200, { status: 'paid', key: 'K' });
      },
    });
    const unlock = vi.fn(async () => 'ok' as const);
    const d = deps({ fetchImpl: fake.impl, unlock, isUnlocked: () => unlocked });
    expect(await checkClaims(PACK, UPGRADE, d)).toBe('none');
    expect(unlock).not.toHaveBeenCalled();
    expect(readClaims(PACK).claims).toEqual([]);
  });

  it('a claim started while a check is out survives it', async () => {
    const first = startClaim(PACK, UPGRADE, NOW)!;
    let second = '';
    const fake = fakeFetch({
      [first]: () => {
        second = startClaim(PACK, UPGRADE, NOW + 1)!;
        return answer(200, { status: 'revoked' });
      },
    });
    await checkClaims(PACK, UPGRADE, deps({ fetchImpl: fake.impl }));
    expect(readClaims(PACK).claims.map((c) => c.claim)).toEqual([second]);
  });
});
