import { PackReviewPage } from '@/pack/PackReviewPage';

/**
 * Pack review — a random sample of the active pack's questions shown with
 * their answers, for judging a pack's quality from inside the app. Reached
 * from Settings → Packs. One static route; the draw happens after mount.
 */
export default function PackReviewRoute() {
  return <PackReviewPage />;
}
