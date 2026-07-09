import { DriveRunner } from '@/pack/DriveRunner';

/**
 * Drive Mode — the practice loop as a hands-free voice conversation
 * for the car. One static route; the session mixes all categories
 * (respecting the level filter), so no query params needed.
 */
export default function DriveRoute() {
  return <DriveRunner />;
}
