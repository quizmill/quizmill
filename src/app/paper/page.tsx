import { PaperPage } from '@/pack/PaperPage';

/**
 * Paper practice — print worksheets, mark them back in. One static
 * route; the selected sheet is carried in the URL hash (`#sheet=<id>`),
 * so no query params are needed for the static export.
 */
export default function PaperRoute() {
  return <PaperPage />;
}
