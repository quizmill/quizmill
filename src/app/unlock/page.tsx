import { UnlockPage } from '@/components/UnlockPage';

/**
 * `/unlock#key=…` — unlock a pack with a licence key. The key rides in
 * the URL fragment (never sent to a server) and is cleared on load.
 */
export default function UnlockRoute() {
  return <UnlockPage />;
}
