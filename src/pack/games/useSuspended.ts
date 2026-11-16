'use client';

import { useSyncExternalStore } from 'react';
import type { GameId } from '@/lib/games/registry';
import { hasSuspended, subscribeSuspended } from '@/lib/games/suspended';

/** Whether `id` has a paused game waiting — live, for the game pickers. */
export function useSuspended(id: GameId): boolean {
  return useSyncExternalStore(
    subscribeSuspended,
    () => hasSuspended(id),
    () => false,
  );
}
