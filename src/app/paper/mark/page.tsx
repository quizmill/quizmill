import { PaperMarkPage } from '@/pack/PaperMarkPage';

/**
 * Marking screen for a printed paper sheet. The sheet arrives in the
 * URL hash — `#s=<payload>` from the printed QR code (self-describing,
 * works on any device with the pack active) or `#sheet=<id>` for a
 * sheet stored on this device — so the route stays static.
 */
export default function PaperMarkRoute() {
  return <PaperMarkPage />;
}
