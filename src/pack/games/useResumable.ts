'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameId } from '@/lib/games/registry';
import { forgetSuspended, peekSuspended, suspendGame } from '@/lib/games/suspended';

/**
 * State for a game that can be paused and picked up later. Starts from
 * the paused game if there is one, else `fresh()`. Whenever the game
 * leaves the screen unfinished — the session's time ran out, or it was
 * closed mid-game — its state is put aside for next time; a finished game
 * leaves nothing behind.
 *
 * A resumed game is `held` until the player's first move, so it doesn't
 * spring back to life before they've found their bearings: the game skips
 * its loop while held, and any `update` releases it.
 */
export function useResumable<S extends { gameOver: boolean }>(
  id: GameId,
  fresh: () => S,
): [S, (next: S | ((s: S) => S)) => void, boolean] {
  // Peek, don't take: the initialiser may run twice in development.
  const [state, setState] = useState<S>(() => peekSuspended<S>(id) ?? fresh());
  const [held, setHeld] = useState(() => peekSuspended<S>(id) !== undefined);

  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  useEffect(() => {
    // On screen now, so no longer paused; put aside again on the way out.
    forgetSuspended(id);
    return () => {
      if (!latest.current.gameOver) suspendGame(id, latest.current);
    };
  }, [id]);

  const update = useCallback((next: S | ((s: S) => S)) => {
    setHeld(false);
    setState(next);
  }, []);

  return [state, update, held];
}
