import { startStaticServer, type Server } from '../e2e/helpers';

/**
 * Global setup for the pack-variant E2E suite. Mirrors the CCA setup
 * on its own port. Caller must have built the pack variant first:
 *   NEXT_PUBLIC_BASE_PATH= npm run build
 * (the prebuild ensure-pack hook seeds the demo pack when none is
 * active — the specs assert against the demo pack's content).
 */
const PORT = 4319;

let server: Server | undefined;

export async function setup(): Promise<void> {
  server = await startStaticServer(PORT);
  process.env.E2E_BASE_URL = server.url;
}

export async function teardown(): Promise<void> {
  if (server) await server.stop();
}
