import { CoachPage } from '@/pack/CoachPage';

/**
 * Coach mode — replay past sessions with the learner. One static route;
 * the selected session is carried in the URL hash (`#session=<id>`), so
 * no query params are needed for the static export.
 */
export default function CoachRoute() {
  return <CoachPage />;
}
