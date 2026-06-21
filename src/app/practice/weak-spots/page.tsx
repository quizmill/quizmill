import { PackReviewRunner } from '@/pack/ReviewRunner';

/** Weak-spots drill — one pool from mistakes, starred questions, and
 *  shaky topics (see lib/weakSpots.ts). */
export default function WeakSpotsPage() {
  return <PackReviewRunner variant="weakspots" />;
}
