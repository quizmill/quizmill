'use client';

import { createContext, useContext } from 'react';

export interface GameRules {
  /**
   * Whether a game may be started over — "Play again" on the result
   * panel, the puzzle's Shuffle. Free play (the arcade) says yes. A game
   * earned by a good practice round is ONE game until game over, so the
   * results screen says no and the restart affordances disappear.
   */
  replay: boolean;
}

export const GameRulesContext = createContext<GameRules>({ replay: true });

export function useGameRules(): GameRules {
  return useContext(GameRulesContext);
}
