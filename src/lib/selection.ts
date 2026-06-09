/**
 * Phase 1 question selection: random, weighted toward unseen questions.
 *
 * Inputs are plain data so this is trivially testable without a DB.
 * The seeded random generator lets tests be deterministic.
 */

export interface SelectableQuestion {
  id: string | number;
  topic: string;
  difficulty: number;
}

export type Rng = () => number; // returns [0, 1)

export function pickSessionQuestions<Q extends SelectableQuestion>(
  bank: Q[],
  options: {
    count: number;
    /** Question IDs already attempted in past sessions (any time). */
    historicalAttemptedIds: Set<Q['id']>;
    /** Question IDs already used in the current session — never repeat. */
    currentSessionIds: Set<Q['id']>;
    rng?: Rng;
  },
): Q[] {
  const { count, historicalAttemptedIds, currentSessionIds } = options;
  const rng = options.rng ?? Math.random;

  const available = bank.filter((q) => !currentSessionIds.has(q.id));
  if (available.length === 0) return [];

  const unseen = available.filter((q) => !historicalAttemptedIds.has(q.id));
  const seen = available.filter((q) => historicalAttemptedIds.has(q.id));

  // Shuffle each pool deterministically with the rng.
  const shuffledUnseen = shuffle(unseen, rng);
  const shuffledSeen = shuffle(seen, rng);

  // Prefer unseen; fall back to seen if we run out.
  const picked = [...shuffledUnseen, ...shuffledSeen].slice(0, count);
  return picked;
}

/**
 * Pick the next single question for a running session.
 * Returns null only if the bank is exhausted.
 */
export function pickNextQuestion<Q extends SelectableQuestion>(
  bank: Q[],
  options: {
    historicalAttemptedIds: Set<Q['id']>;
    currentSessionIds: Set<Q['id']>;
    rng?: Rng;
  },
): Q | null {
  const [picked] = pickSessionQuestions(bank, {
    count: 1,
    historicalAttemptedIds: options.historicalAttemptedIds,
    currentSessionIds: options.currentSessionIds,
    rng: options.rng,
  });
  return picked ?? null;
}

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deterministic PRNG (mulberry32) for tests.
 */
export function seededRng(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
