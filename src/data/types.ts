/**
 * Engine record types — what the storage / sync / mistakes layers
 * operate on. Question shapes live in src/pack/data.ts (they come from
 * the active pack); the engine only sees the denormalised fields it
 * needs on each attempt.
 *
 * The analytics fields (position, firstSelected, feedbackSeconds, …) are
 * all optional: rows written by older builds simply lack them, and every
 * consumer treats "absent" as "unknown" — never as zero.
 */

/** How a session was run. Older records omit it (= 'practice'). */
export type SessionMode = 'practice' | 'review' | 'drive' | 'notes';

export interface Attempt {
  id: string; // crypto.randomUUID() at write time
  sessionId: string;
  questionId: string;
  answeredAt: number; // unix ms
  selectedAnswer: string;
  isCorrect: boolean;
  /** Seconds from the question appearing to Check. Older builds always
   *  wrote 1 here (no clock ran), so treat 1 as "unmeasured" in analysis. */
  timeTakenSeconds: number;
  // Denormalised for offline querying without the question bank.
  // `subject` carries the pack category key; `topic` is the rescue key
  // for the mistakes engine (quizmill packs use the question id — a
  // mistake is rescued only by re-answering that question correctly).
  subject: string;
  topic: string;
  difficulty: number;
  /** 1-based position within the session — fatigue/abandonment analysis. */
  position?: number;
  /** The first option tapped before any revision — first-instinct signal.
   *  Same encoding as selectedAnswer (a single sorted key). */
  firstSelected?: string;
  /** Denormalised from the session so per-mode splits need no join. */
  mode?: SessionMode;
  /** The scenario this question sat under, when it had a shared stem. */
  scenarioId?: string;
  /** Seconds spent on the explanation before moving on. Written by a
   *  follow-up upsert of the same row, so it's absent on abandoned tails. */
  feedbackSeconds?: number;
  /** Engine+pack build stamp (NEXT_PUBLIC_APP_BUILD) — ties an answer to
   *  the exact question content it was shown. */
  appBuild?: string;
}

export interface Session {
  id: string; // crypto.randomUUID()
  /** Pack category key (see Attempt.subject), or 'drive' for Drive Mode
   *  sessions (which mix categories; their attempts keep real keys). */
  subject: string;
  startedAt: number;
  endedAt: number | null;
  questionCount: number;
  correctCount: number;
  /** Optional. Defaults to 'practice' when missing (older records). */
  mode?: SessionMode;
  /** Engine+pack build stamp — see Attempt.appBuild. */
  appBuild?: string;
  /** 'standalone' when running as an installed PWA, else 'browser'. */
  display?: 'standalone' | 'browser';
  /** Coarse device class — deliberately nothing finer (no UA, no sizes). */
  platform?: 'touch' | 'desktop';
}

/**
 * A lightweight app event — feature usage that isn't an answer (game
 * opened, PWA installed, progress exported, …). The type list is CLOSED:
 * extend it here (and instrument the call site) rather than inventing
 * types at call sites, so the analytics side never meets junk.
 */
export type AppEventType =
  | 'app_open'
  | 'pwa_install'
  | 'game_open'
  | 'progress_view'
  | 'export'
  | 'import'
  | 'sync_sign_in';

export interface AppEvent {
  id: string; // crypto.randomUUID()
  type: AppEventType;
  at: number; // unix ms
  /** Small, flat context: e.g. { game: 'snake' } — never free text. */
  data?: Record<string, string | number | boolean>;
}
