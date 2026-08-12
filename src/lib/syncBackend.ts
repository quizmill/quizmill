/**
 * Pluggable cloud-sync backend contract.
 *
 * The sync engine (src/lib/sync.ts) owns the queue/drain/merge machinery
 * and speaks to the cloud only through this interface. Two backends exist:
 *
 *   • "worker"   — a tiny Cloudflare Worker + D1 database (cloudflare/),
 *                  authenticated by a locally-stored sync key. Free tier,
 *                  and Cloudflare never pauses or deletes inactive
 *                  Workers/D1 databases. Selected when
 *                  NEXT_PUBLIC_SYNC_URL is set at build time.
 *   • "supabase" — the original Supabase mirror (email-OTP auth, RLS).
 *                  Selected when the NEXT_PUBLIC_SUPABASE_* vars are set.
 *
 * When both are configured the worker wins (it's the recommended path);
 * when neither is, sync stays dormant and the app is pure-local.
 */
import type { Attempt, Session } from '@/data/types';
import type { EarnedAchievement, QuestionVote } from './storage';

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
  /** Execute one queued op. Throws on (retryable) failure. */
  runOp(op: QueueOp, userId: string): Promise<void>;
  /** Fetch every remote row for this user + pack. */
  pullAll(userId: string): Promise<RemoteData>;
}

// ── Backend selection (decided at build time by env vars) ───────────────

export type SyncBackendKind = 'worker' | 'supabase' | null;

/** Which backend this build is wired to, if any. */
export function syncBackendKind(): SyncBackendKind {
  if (process.env.NEXT_PUBLIC_SYNC_URL) return 'worker';
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return 'supabase';
  }
  return null;
}

// The impl modules import only *types* from this file, so these imports
// don't create a runtime cycle.
import { supabaseBackend } from './backends/supabaseBackend';
import { workerBackend } from './backends/workerBackend';

/** The configured backend, or null when sync isn't configured. */
export function getSyncBackend(): SyncBackend | null {
  switch (syncBackendKind()) {
    case 'worker':
      return workerBackend;
    case 'supabase':
      return supabaseBackend;
    default:
      return null;
  }
}
