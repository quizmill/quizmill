/**
 * localStorage-backed persistence for sessions + attempts.
 *
 * Designed as a thin module rather than a class so it's easy to mock in
 * tests. The schema lives entirely client-side; the same data shape can
 * later be served by an HTTP API by swapping these functions out.
 *
 * SSR safety: every public function checks for `window` first. During the
 * static export build, the pages render with empty state; localStorage is
 * read once on mount via the hooks in `useStorage.ts`.
 */
import type { Attempt, Session } from '@/data/types';
import { APP_CONFIG } from '@/config';

// Per-pack key namespace so different packs opened in the same browser
// don't mix attempt histories. Exported so the useStorage snapshot
// functions (which need the raw key for change-detection) can stay in
// sync.
export const KEY_PREFIX = `quizmill.${APP_CONFIG.packId}.`;
export const SESSIONS_KEY = `${KEY_PREFIX}sessions.v1`;
export const ATTEMPTS_KEY = `${KEY_PREFIX}attempts.v1`;
const ACHIEVEMENTS_KEY = `${KEY_PREFIX}achievements.v1`;
const VOTES_KEY = `${KEY_PREFIX}votes.v1`;
const PREFS_KEY = `${KEY_PREFIX}prefs.v1`;
const SCRATCHPAD_KEY = `${KEY_PREFIX}scratchpad.v1`;

export type VoteDir = 'up' | 'down';

export interface QuestionVote {
  questionId: string;
  vote: VoteDir;
  /** Optional reason — only ever set for downvotes. */
  comment?: string;
  votedAt: number; // unix ms
}

export interface EarnedAchievement {
  /** Opaque achievement key — the engine doesn't interpret it. */
  id: string;
  earnedAt: number; // unix ms
}

function browser(): boolean {
  return typeof window !== 'undefined';
}

// ---- mutation bus ----
//
// The cloud-sync layer (src/lib/sync.ts) subscribes here to mirror local
// writes up to Supabase. With no subscribers this is inert, so the
// pure-local app behaves exactly the same without sync configured.

export type Mutation =
  | { table: 'sessions'; row: Session }
  | { table: 'attempts'; row: Attempt }
  | { table: 'achievements'; row: EarnedAchievement }
  | { table: 'votes'; row: QuestionVote }
  | { table: 'votes'; op: 'delete'; questionId: string }
  | { table: 'clear-all' }
  | { table: 'clear-sessions'; op: 'delete'; sessionIds: string[] };

const mutationListeners = new Set<(m: Mutation) => void>();

/** Subscribe to local mutations. Returns an unsubscribe fn. */
export function onMutation(fn: (m: Mutation) => void): () => void {
  mutationListeners.add(fn);
  return () => mutationListeners.delete(fn);
}

function notify(m: Mutation): void {
  for (const fn of mutationListeners) {
    try {
      fn(m);
    } catch {
      // a faulty listener must never break a local write
    }
  }
}

function readJson<T>(key: string, fallback: T): T {
  if (!browser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (!browser()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

// ---- prefs (local-only UI preferences; deliberately not synced) ----

export interface PackPrefs {
  /** Active level-band filter (a manifest level key); absent = "All". */
  level?: string;
  /** The last adaptive level nudge the user dismissed, as "from>to", so the
   *  same suggestion doesn't keep re-appearing. */
  dismissedNudge?: string;
  /** Drive Mode opt-in — shows the hands-free voice quiz entry on Home.
   *  Absent = off: it's a niche mode, so Home stays uncluttered by default. */
  driveMode?: boolean;
  /** Preferred TTS voice for Drive Mode (a SpeechSynthesisVoice.voiceURI).
   *  Absent = auto-pick (quality-hinted, see pickDefaultVoice). */
  driveVoice?: string;
  /** Drive Mode speaking rate multiplier. Absent = 1 (normal). */
  driveRate?: number;
}

export function loadPrefs(): PackPrefs {
  return readJson<PackPrefs>(PREFS_KEY, {});
}

/** The active level-band filter, or null for "All". */
export function loadLevelFilter(): string | null {
  return loadPrefs().level ?? null;
}

export function saveLevelFilter(level: string | null): void {
  const prefs = loadPrefs();
  if (level) prefs.level = level;
  else delete prefs.level;
  writeJson(PREFS_KEY, prefs);
}

/** The level-nudge suggestion the user last dismissed ("from>to"), or null. */
export function loadDismissedNudge(): string | null {
  return loadPrefs().dismissedNudge ?? null;
}

export function saveDismissedNudge(key: string | null): void {
  const prefs = loadPrefs();
  if (key) prefs.dismissedNudge = key;
  else delete prefs.dismissedNudge;
  writeJson(PREFS_KEY, prefs);
}

/** Whether Drive Mode is switched on (Settings toggle). Default off. */
export function loadDriveModeEnabled(): boolean {
  return loadPrefs().driveMode === true;
}

export function saveDriveModeEnabled(on: boolean): void {
  const prefs = loadPrefs();
  if (on) prefs.driveMode = true;
  else delete prefs.driveMode;
  writeJson(PREFS_KEY, prefs);
}

/** Drive Mode voice/speed prefs, rate clamped to the sane speaking band. */
export function loadDriveVoicePrefs(): { voiceURI: string | null; rate: number } {
  const prefs = loadPrefs();
  const rawRate = typeof prefs.driveRate === 'number' ? prefs.driveRate : 1;
  return {
    voiceURI: prefs.driveVoice ?? null,
    rate: Math.min(1.5, Math.max(0.5, rawRate)),
  };
}

export function saveDriveVoice(voiceURI: string | null): void {
  const prefs = loadPrefs();
  if (voiceURI) prefs.driveVoice = voiceURI;
  else delete prefs.driveVoice;
  writeJson(PREFS_KEY, prefs);
}

export function saveDriveRate(rate: number): void {
  const prefs = loadPrefs();
  if (rate !== 1) prefs.driveRate = rate;
  else delete prefs.driveRate;
  writeJson(PREFS_KEY, prefs);
}

// ---- scratchpad (local-only working notes; deliberately not synced) ----

export type ScratchpadMode = 'write' | 'draw';

/**
 * One freehand stroke. Points are normalised to 0..1 of the canvas box, so a
 * drawing redraws correctly whatever width the panel happens to be on replay
 * (and stays tiny in storage — vectors, not a base64 image).
 */
export interface ScratchStroke {
  color: string;
  points: { x: number; y: number }[];
}

/** Default pen colour (ink-800). Shared with the Draw palette in the UI. */
export const DEFAULT_PEN_COLOR = '#1c2029';

export interface Scratchpad {
  /** Typed notes — the Write tab. */
  text: string;
  /** Freehand strokes — the Draw tab. */
  strokes: ScratchStroke[];
  /** Which tab is showing. */
  mode: ScratchpadMode;
  /** Selected pen colour for the Draw tab. */
  color: string;
  /** Whether the panel is expanded; remembered so it stays as the user left it. */
  open: boolean;
}

export const EMPTY_SCRATCHPAD: Scratchpad = {
  text: '',
  strokes: [],
  mode: 'write',
  color: DEFAULT_PEN_COLOR,
  open: false,
};

function isPoint(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false;
  const pt = p as Record<string, unknown>;
  return typeof pt.x === 'number' && typeof pt.y === 'number';
}

function isStroke(s: unknown): s is ScratchStroke {
  if (!s || typeof s !== 'object') return false;
  const stroke = s as Record<string, unknown>;
  return (
    typeof stroke.color === 'string' &&
    Array.isArray(stroke.points) &&
    stroke.points.every(isPoint)
  );
}

/**
 * Coerce whatever is in storage into a valid Scratchpad. Tolerates the
 * pre-draw shape (`{ text, open }`, no strokes/mode/colour) and any partial
 * or junk data (including malformed strokes/points), so pads saved by older
 * builds keep working and a corrupted entry can't crash a redraw.
 */
export function normalizeScratchpad(raw: unknown): Scratchpad {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_SCRATCHPAD };
  const r = raw as Record<string, unknown>;
  return {
    text: typeof r.text === 'string' ? r.text : '',
    strokes: Array.isArray(r.strokes) ? r.strokes.filter(isStroke) : [],
    mode: r.mode === 'draw' ? 'draw' : 'write',
    color: typeof r.color === 'string' ? r.color : DEFAULT_PEN_COLOR,
    open: r.open === true,
  };
}

export function loadScratchpad(): Scratchpad {
  return normalizeScratchpad(readJson<unknown>(SCRATCHPAD_KEY, null));
}

export function saveScratchpad(value: Scratchpad): void {
  writeJson(SCRATCHPAD_KEY, value);
}

// ---- sessions ----

export function loadSessions(): Session[] {
  return readJson<Session[]>(SESSIONS_KEY, []);
}

export function saveSession(session: Session): void {
  const all = loadSessions();
  const i = all.findIndex((s) => s.id === session.id);
  if (i >= 0) all[i] = session;
  else all.push(session);
  writeJson(SESSIONS_KEY, all);
  notify({ table: 'sessions', row: session });
}

export function getSession(id: string): Session | undefined {
  return loadSessions().find((s) => s.id === id);
}

// ---- attempts ----

export function loadAttempts(): Attempt[] {
  return readJson<Attempt[]>(ATTEMPTS_KEY, []);
}

export function saveAttempt(attempt: Attempt): void {
  const all = loadAttempts();
  all.push(attempt);
  writeJson(ATTEMPTS_KEY, all);
  notify({ table: 'attempts', row: attempt });
}

export function attemptsForSession(sessionId: string): Attempt[] {
  return loadAttempts().filter((a) => a.sessionId === sessionId);
}

export function attemptsForCategory(categoryKey: string): Attempt[] {
  return loadAttempts().filter((a) => a.subject === categoryKey);
}

// ---- achievements ----

export function loadAchievements(): EarnedAchievement[] {
  return readJson<EarnedAchievement[]>(ACHIEVEMENTS_KEY, []);
}

export function saveAchievements(earned: EarnedAchievement[]): void {
  writeJson(ACHIEVEMENTS_KEY, earned);
}

/**
 * Idempotently append new earned achievements. Anything already recorded
 * is left alone (so the original earnedAt is preserved). Returns the
 * actually-new entries that were appended.
 */
export function recordEarnedAchievements(
  ids: readonly string[],
  now: number = Date.now(),
): EarnedAchievement[] {
  const existing = loadAchievements();
  const have = new Set(existing.map((e) => e.id));
  const added: EarnedAchievement[] = [];
  for (const id of ids) {
    if (have.has(id)) continue;
    have.add(id); // guard against duplicates within the input list
    added.push({ id, earnedAt: now });
  }
  if (added.length > 0) {
    saveAchievements([...existing, ...added]);
    for (const a of added) notify({ table: 'achievements', row: a });
  }
  return added;
}

// ---- question votes ----

export function loadVotes(): QuestionVote[] {
  return readJson<QuestionVote[]>(VOTES_KEY, []);
}

export function saveVotes(votes: QuestionVote[]): void {
  writeJson(VOTES_KEY, votes);
}

/**
 * Upsert a vote. If the user has already voted on this question, the
 * existing entry is replaced (so they can change their mind, or add a
 * comment to a downvote later). Pass `vote: null` to clear.
 */
export function recordVote(
  questionId: string,
  vote: VoteDir | null,
  comment?: string,
  now: number = Date.now(),
): void {
  const all = loadVotes();
  const idx = all.findIndex((v) => v.questionId === questionId);
  if (vote === null) {
    if (idx >= 0) {
      all.splice(idx, 1);
      saveVotes(all);
      notify({ table: 'votes', op: 'delete', questionId });
    }
    return;
  }
  const entry: QuestionVote = {
    questionId,
    vote,
    votedAt: now,
    ...(vote === 'down' && comment ? { comment } : {}),
  };
  if (idx >= 0) all[idx] = entry;
  else all.push(entry);
  saveVotes(all);
  notify({ table: 'votes', row: entry });
}

export function getVote(questionId: string): QuestionVote | undefined {
  return loadVotes().find((v) => v.questionId === questionId);
}

// ---- bulk ops ----

/**
 * Wipe ALL stored sessions, attempts, achievements, and votes for the
 * active pack. Use with care.
 */
export function clearAll(): void {
  if (!browser()) return;
  window.localStorage.removeItem(SESSIONS_KEY);
  window.localStorage.removeItem(ATTEMPTS_KEY);
  window.localStorage.removeItem(ACHIEVEMENTS_KEY);
  window.localStorage.removeItem(VOTES_KEY);
  window.localStorage.removeItem(PREFS_KEY);
  window.localStorage.removeItem(SCRATCHPAD_KEY);
  notify({ table: 'clear-all' });
}

/**
 * Wipe just the sessions started since the given epoch milliseconds (and the
 * attempts that belong to those sessions). Used by the "reset today" control.
 */
export function clearSince(epochMs: number): { sessionsRemoved: number; attemptsRemoved: number } {
  if (!browser()) return { sessionsRemoved: 0, attemptsRemoved: 0 };

  const sessions = loadSessions();
  const keepSessions = sessions.filter((s) => s.startedAt < epochMs);
  const removedSessionIds = new Set(
    sessions.filter((s) => s.startedAt >= epochMs).map((s) => s.id),
  );

  const attempts = loadAttempts();
  const keepAttempts = attempts.filter((a) => !removedSessionIds.has(a.sessionId));

  writeJson(SESSIONS_KEY, keepSessions);
  writeJson(ATTEMPTS_KEY, keepAttempts);

  if (removedSessionIds.size > 0) {
    notify({
      table: 'clear-sessions',
      op: 'delete',
      sessionIds: [...removedSessionIds],
    });
  }

  return {
    sessionsRemoved: sessions.length - keepSessions.length,
    attemptsRemoved: attempts.length - keepAttempts.length,
  };
}

/**
 * Merge a batch of rows pulled from the cloud into local storage WITHOUT
 * emitting mutations (which would feed straight back into the sync queue).
 * Last-write-wins per row, decided by the natural timestamp on each shape.
 * Used by src/lib/sync.ts on sign-in / pull. Returns true if anything
 * actually changed locally.
 */
export function mergeRemote(remote: {
  sessions?: Session[];
  attempts?: Attempt[];
  achievements?: EarnedAchievement[];
  votes?: QuestionVote[];
}): boolean {
  if (!browser()) return false;
  let changed = false;

  if (remote.sessions?.length) {
    const byId = new Map(loadSessions().map((s) => [s.id, s]));
    for (const r of remote.sessions) {
      const local = byId.get(r.id);
      // A session is updated in place (endedAt, counts); prefer the row
      // that progressed furthest in time.
      const score = (s: Session) => s.endedAt ?? s.startedAt;
      if (!local || score(r) > score(local)) {
        byId.set(r.id, r);
        changed = true;
      }
    }
    if (changed) writeJson(SESSIONS_KEY, [...byId.values()]);
  }

  if (remote.attempts?.length) {
    const byId = new Map(loadAttempts().map((a) => [a.id, a]));
    let attemptsChanged = false;
    for (const r of remote.attempts) {
      if (!byId.has(r.id)) {
        byId.set(r.id, r); // attempts are immutable once written
        attemptsChanged = true;
      }
    }
    if (attemptsChanged) {
      writeJson(ATTEMPTS_KEY, [...byId.values()]);
      changed = true;
    }
  }

  if (remote.achievements?.length) {
    const byId = new Map(loadAchievements().map((a) => [a.id, a]));
    let achChanged = false;
    for (const r of remote.achievements) {
      const local = byId.get(r.id);
      if (!local || r.earnedAt < local.earnedAt) {
        byId.set(r.id, r); // keep the earliest unlock time
        achChanged = true;
      }
    }
    if (achChanged) {
      saveAchievements([...byId.values()]);
      changed = true;
    }
  }

  if (remote.votes?.length) {
    const byQ = new Map(loadVotes().map((v) => [v.questionId, v]));
    let votesChanged = false;
    for (const r of remote.votes) {
      const local = byQ.get(r.questionId);
      if (!local || r.votedAt >= local.votedAt) {
        byQ.set(r.questionId, r);
        votesChanged = true;
      }
    }
    if (votesChanged) {
      saveVotes([...byQ.values()]);
      changed = true;
    }
  }

  return changed;
}

/** Return start-of-day epoch for the local timezone today. */
export function startOfTodayEpoch(now = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
