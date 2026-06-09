/**
 * Supabase client — the cloud side of cloud sync.
 *
 * The app is a static export with no server, so this runs entirely in the
 * browser: PKCE flow, session persisted to localStorage, and the magic-link
 * callback resolved automatically from the URL on load.
 *
 * Sync is OPTIONAL. When the env vars are absent (e.g. a fork without a
 * Supabase project) `getSupabase()` returns null and the whole sync layer
 * stays dormant — the app keeps working as a pure-local single-device app.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '@/config';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** True when a Supabase project is configured for this build. */
export const SYNC_CONFIGURED = Boolean(URL && KEY);

let client: SupabaseClient | null = null;

/**
 * Lazily-created singleton. Returns null when sync isn't configured, so
 * callers can no-op cleanly. Never throws.
 */
export function getSupabase(): SupabaseClient | null {
  if (!SYNC_CONFIGURED) return null;
  if (typeof window === 'undefined') return null; // browser-only
  if (!client) {
    client = createClient(URL!, KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        // Per-variant auth namespace — each variant points at its own
        // Supabase project, so a session on one shouldn't masquerade as
        // a session on the other.
        storageKey: `quizmill.${APP_CONFIG.packId}.auth.v1`,
      },
    });
  }
  return client;
}

/** The URL the magic link should send the user back to. Includes the
 *  GitHub Pages basePath in production. */
export function authRedirectUrl(): string {
  if (typeof window === 'undefined') return '';
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return `${window.location.origin}${base}/`;
}
