/**
 * Games left unfinished — run out of session time, or closed mid-game —
 * kept so the next session carries on instead of starting over. Only the
 * long-running games take part (`RESUMABLE`); the others finish well
 * inside a session.
 *
 * In memory only, by design: a paused game lasts until the tab closes.
 * Nothing stored, nothing synced — the same promise the earned game makes.
 */
import type { GameId } from './registry';

export const RESUMABLE: readonly GameId[] = ['tetris', 'snake'];

const saved = new Map<GameId, unknown>();
const listeners = new Set<() => void>();

function changed() {
  for (const l of listeners) l();
}

/** For `useSyncExternalStore`: a game is put aside as it unmounts, after
 *  the screen offering it has rendered, so pickers subscribe. */
export function subscribeSuspended(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function suspendGame(id: GameId, state: unknown): void {
  saved.set(id, state);
  changed();
}

/** The paused game's state, if any — left in place (see `forgetSuspended`). */
export function peekSuspended<S>(id: GameId): S | undefined {
  return saved.get(id) as S | undefined;
}

export function hasSuspended(id: GameId): boolean {
  return saved.has(id);
}

export function forgetSuspended(id: GameId): void {
  if (saved.delete(id)) changed();
}
