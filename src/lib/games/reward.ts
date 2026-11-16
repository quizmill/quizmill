/**
 * When a finished practice round earns a game.
 *
 * Half the round right, or better. That is the line under which the
 * results screen stops saying "Well done!" (ScoreCelebration's tiers
 * flip to "keep going" below 50%), and a game is a reward for a round
 * that went well — never a consolation prize. Only the practice runner
 * offers one: review, exam and notes rounds stay game-free, and Drive is
 * hands-off by design.
 *
 * Nothing is stored. The offer lives on the results screen that earned
 * it: one game, played there and then, gone when the screen is left.
 */
export const EARN_GAME_MIN_RATIO = 0.5;

export function earnsGame(correct: number, answered: number): boolean {
  return answered > 0 && correct / answered >= EARN_GAME_MIN_RATIO;
}
