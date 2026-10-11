import GamesPage from '@/pack/GamesPage';

/**
 * Reward-games arcade. One static route for every build: whether there
 * is anything to play is decided by the ACTIVE pack when the page
 * renders (GamesPage), not by the pack this deployment was built from.
 * The static export is prerendered once, so a build-time `notFound()`
 * here left the route dead for a pack with games swapped in at runtime
 * via the pack library, while the Settings easter egg (which reads the
 * active pack) still linked to it.
 */
export default function GamesRoute() {
  return <GamesPage />;
}
