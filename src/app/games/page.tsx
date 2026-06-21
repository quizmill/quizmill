import { notFound } from 'next/navigation';
import { gamesEnabled } from '@/pack/data';
import GamesPage from '@/pack/GamesPage';

/**
 * Reward-games arcade. Only a real route for packs that switch games on in
 * their manifest (`games` block); otherwise it 404s, exactly like a pack
 * with no games declared has no games anywhere.
 */
export default function GamesRoute() {
  if (!gamesEnabled) notFound();
  return <GamesPage />;
}
