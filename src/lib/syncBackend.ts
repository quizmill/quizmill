/**
 * Pluggable cloud-sync backend contract + provider registry.
 *
 * The sync engine (src/lib/sync.ts) owns the queue/drain/merge machinery
 * and speaks to the cloud only through the SyncBackend interface. Which
 * backend a build uses is decided by walking the provider registry —
 * first configured provider wins, or `NEXT_PUBLIC_SYNC_BACKEND` names one
 * explicitly when several are configured.
 *
 * Built-in providers (registered below, in priority order):
 *
 *   • "http"     — any server speaking the quizmill sync protocol
 *                  (docs/sync-protocol.md): two endpoints + bearer
 *                  sync-key auth. The Cloudflare Worker in cloudflare/
 *                  is the reference implementation (free tier, never
 *                  paused/deleted for inactivity), but anything that
 *                  implements the protocol works — roll your own in
 *                  express/Deno/PHP/… Selected by NEXT_PUBLIC_SYNC_URL.
 *   • "supabase" — the original Supabase mirror (email-OTP auth, RLS).
 *                  Selected by the NEXT_PUBLIC_SUPABASE_* pair.
 *
 * Rolling your own CLIENT backend (different transport, e2e encryption,
 * WebDAV, …): implement SyncBackend, call registerSyncBackendProvider()
 * from module scope before the app mounts (e.g. in a module imported by
 * SyncBootstrap), and register a Settings card for its sign-in UI with
 * registerSyncSettingsCard (src/components/SyncSettings.tsx). For
 * one-off, serverless transfer between devices there's also the file
 * export/import path (src/lib/transfer.ts) — same data contract, no
 * backend needed.
 *
 * With no provider configured, sync stays dormant and the app is
 * pure-local.
 */
import type { Attempt, Session } from '@/data/types';
import type { EarnedAchievement, QuestionVote } from './storage';
// The impl modules import only *types* from this file, so these imports
// don't create a runtime cycle.
import { httpBackend } from './backends/httpBackend';
import { supabaseBackend } from './backends/supabaseBackend';

// ── Queue ops (produced by the engine, executed by a backend) ───────────

export type QueueOp =
  | { t: 'sessions'; op: 'upsert'; row: Session }
  | { t: 'attempts'; op: 'upsert'; row: Attempt }
  | { t: 'achievements'; op: 'upsert'; row: EarnedAchievement }
  | { t: 'votes'; op: 'upsert'; row: QuestionVote }
  | { t: 'votes'; op: 'delete'; questionId: string }
  | { t: 'clear-all'; op: 'delete' }
  | { t: 'clear-sessions'; op: 'delete'; sessionIds: string[] };

/** Everything a pull returns, already mapped to the local shapes. */
export interface RemoteData {
  sessions: Session[];
  attempts: Attempt[];
  achievements: EarnedAchievement[];
  votes: QuestionVote[];
}

export interface SyncBackend {
  /** Resolve the currently signed-in user (null when signed out). The id is
   *  opaque — the engine only uses it to partition local flags and to pass
   *  back into runOp/pullAll. */
  getUserId(): Promise<string | null>;
  /** Subscribe to sign-in/sign-out. May fire immediately on subscribe. */
  onAuthChange(cb: (userId: string | null) => void): void;
  /** Execute one queued op. Throws on a (retryable) failure. */
  runOp(op: QueueOp, userId: string): Promise<void>;
  /** Fetch every remote row for this user + pack. */
  pullAll(userId: string): Promise<RemoteData>;
}

// ── Provider registry ───────────────────────────────────────────────────

export interface SyncBackendProvider {
  /** Registry key — also what NEXT_PUBLIC_SYNC_BACKEND matches against. */
  kind: string;
  /** Whether this build's environment configures the backend. */
  isConfigured(): boolean;
  /** Build the backend. Called at most once; the instance is cached. */
  create(): SyncBackend;
  /** Short human label for the Settings card footer, e.g.
   *  "Sync server · example.workers.dev". Falls back to the kind. */
  describe?(): string;
}

const providers: (SyncBackendProvider & { instance?: SyncBackend })[] = [];

/**
 * Register a provider. Later registrations lose to earlier ones when
 * several are configured, so custom providers pass `prepend: true` (or
 * name themselves in NEXT_PUBLIC_SYNC_BACKEND) to beat the built-ins.
 * Call from module scope, before the app mounts/startSync runs.
 */
export function registerSyncBackendProvider(
  provider: SyncBackendProvider,
  opts?: { prepend?: boolean },
): void {
  if (providers.some((p) => p.kind === provider.kind)) {
    throw new Error(`sync backend "${provider.kind}" is already registered`);
  }
  if (opts?.prepend) providers.unshift(provider);
  else providers.push(provider);
}

function activeProvider(): (SyncBackendProvider & { instance?: SyncBackend }) | null {
  // Explicit pick — for builds with several backends configured, or a
  // custom provider that shouldn't rely on registration order.
  const forced = process.env.NEXT_PUBLIC_SYNC_BACKEND;
  if (forced) {
    const p = providers.find((x) => x.kind === forced);
    // A forced-but-unconfigured backend stays dormant (misconfiguration
    // shows up as "sync off", never as a silent fallback to another store).
    return p && p.isConfigured() ? p : null;
  }
  return providers.find((p) => p.isConfigured()) ?? null;
}

/** The kind of backend this build is wired to, or null when sync is off. */
export function syncBackendKind(): string | null {
  return activeProvider()?.kind ?? null;
}

/** The configured backend (cached instance), or null when sync is off. */
export function getSyncBackend(): SyncBackend | null {
  const p = activeProvider();
  if (!p) return null;
  p.instance ??= p.create();
  return p.instance;
}

export interface SyncBackendInfo {
  kind: string;
  /** Human-readable label incl. the target host — shown in Settings so a
   *  deployed app always answers "where does my data sync to?". */
  label: string;
}

/** Identity of the active backend, or null when sync isn't configured. */
export function syncBackendInfo(): SyncBackendInfo | null {
  const p = activeProvider();
  if (!p) return null;
  return { kind: p.kind, label: p.describe?.() ?? p.kind };
}

/** The hostname of a URL, or the raw string when it doesn't parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ── Built-ins ───────────────────────────────────────────────────────────

registerSyncBackendProvider({
  kind: 'http',
  isConfigured: () => Boolean(process.env.NEXT_PUBLIC_SYNC_URL),
  create: () => httpBackend,
  describe: () => `Sync server · ${hostOf(process.env.NEXT_PUBLIC_SYNC_URL ?? '')}`,
});

registerSyncBackendProvider({
  kind: 'supabase',
  isConfigured: () =>
    Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  create: () => supabaseBackend,
  describe: () => `Supabase · ${hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')}`,
});
