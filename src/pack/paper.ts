/**
 * Paper practice — pure logic for printed worksheets and marking them
 * back into progress. The React pages (PaperPage / PaperMarkPage) are
 * the I/O shells; everything that can be a function of plain inputs
 * lives here, same split as runner.ts.
 *
 * A sheet is composed from the bank by the normal selection engine,
 * persisted locally (deliberately NOT synced — no new table), and
 * printed with a QR code that deep-links to the marking page carrying
 * the whole question list in the URL fragment. That makes the sheet
 * self-describing: any device with the same pack active (and, for the
 * results to mirror, the same sync key) can mark it, with zero server
 * or protocol changes.
 *
 * Marking writes ordinary Session/Attempt rows with `mode: 'paper'` and
 * DETERMINISTIC ids derived from the sheet id, so marking twice — or on
 * two devices — upserts the same rows instead of duplicating history.
 */

import { APP_BUILD } from '@/config';
import type { Attempt, Session } from '@/data/types';
import { KEY_PREFIX } from '@/lib/storage';
import type { AttemptSummary } from '@/lib/selection';
import { isMultiAnswer, type OptionKey, type PackQuestion } from '@/pack/data';
import { deviceContext, gradeSelection, pickSessionFromBank } from '@/pack/runner';

// ── Sheet records ────────────────────────────────────────────────────────

/** A printed (or printable) worksheet, stored on the composing device. */
export interface PaperSheet {
  /** UUID; doubles as the marked session's id (see buildPaperSession). */
  id: string;
  /** Short human code shown on the printout ("P-7KQ4") for telling
   *  sheets on the kitchen table apart. Not an identifier — the QR
   *  payload and local record carry the real id. */
  code: string;
  createdAt: number;
  categoryKey: string;
  /** Level-band filter the sheet was composed with, when the pack has
   *  levels — informational only. */
  level?: string;
  questionIds: string[];
  /** Stamped once the sheet has been marked on this device. */
  markedAt?: number;
}

export const PAPER_SHEETS_KEY = `${KEY_PREFIX}paperSheets.v1`;

/** Newest sheets kept per pack — an old unmarked sheet is a lost piece
 *  of paper, not history worth keeping. */
export const MAX_STORED_SHEETS = 50;

/** Question count choices offered when composing (clamped to the bank). */
export const PAPER_COUNT_CHOICES = [5, 10, 15, 20] as const;
export const DEFAULT_PAPER_COUNT = 10;

// Unambiguous letters/digits for the human sheet code — no 0/O, 1/I/L,
// 5/S, 8/B so a scribbled note or a phone photo can't misread it.
const CODE_ALPHABET = 'ACDEFHJKMNPQRTUVWXYZ234679';

export function newSheetCode(rng: () => number = Math.random): string {
  let body = '';
  for (let i = 0; i < 4; i++) {
    body += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  return `P-${body}`;
}

/**
 * Compose a new sheet from a bank (already filtered to the category and
 * level, exactly like a practice session) using the same unseen-biased
 * selection. Returns null when the bank is empty.
 */
export function composePaperSheet(
  bank: PackQuestion[],
  history: ReadonlyMap<string, AttemptSummary>,
  options: {
    categoryKey: string;
    count: number;
    level?: string;
    id?: string;
    code?: string;
    now?: number;
    rng?: () => number;
  },
): { sheet: PaperSheet; questions: PackQuestion[] } | null {
  const questions = pickSessionFromBank(bank, history, options.rng, options.count);
  if (!questions) return null;
  return {
    sheet: {
      id: options.id ?? crypto.randomUUID(),
      code: options.code ?? newSheetCode(options.rng),
      createdAt: options.now ?? Date.now(),
      categoryKey: options.categoryKey,
      ...(options.level ? { level: options.level } : {}),
      questionIds: questions.map((q) => q.id),
    },
    questions,
  };
}

// ── Local persistence (per pack, not synced) ─────────────────────────────

export function loadPaperSheets(): PaperSheet[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PAPER_SHEETS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PaperSheet[]) : [];
  } catch {
    return [];
  }
}

function writePaperSheets(sheets: PaperSheet[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PAPER_SHEETS_KEY, JSON.stringify(sheets));
  } catch {
    // storage unavailable — the in-page state still applies
  }
}

/** Insert or replace by id; newest first, capped at MAX_STORED_SHEETS. */
export function savePaperSheet(sheet: PaperSheet): void {
  const rest = loadPaperSheets().filter((s) => s.id !== sheet.id);
  writePaperSheets([sheet, ...rest].slice(0, MAX_STORED_SHEETS));
}

/**
 * Keep a sheet that arrived from elsewhere (a scanned QR / `#s=` link)
 * on this device, so it shows in the Paper list, can be re-marked and
 * can print its answer key here too. The local record wins when one
 * already exists — it may carry `markedAt`, which the payload never
 * does.
 */
export function adoptPaperSheet(sheet: PaperSheet): PaperSheet {
  const existing = getPaperSheet(sheet.id);
  if (existing) return existing;
  savePaperSheet(sheet);
  return sheet;
}

export function deletePaperSheet(id: string): void {
  writePaperSheets(loadPaperSheets().filter((s) => s.id !== id));
}

export function getPaperSheet(id: string): PaperSheet | undefined {
  return loadPaperSheets().find((s) => s.id === id);
}

/** Stamp a locally stored sheet as marked. No-op for an unknown id —
 *  the sheet may have been printed on another device. */
export function recordSheetMarked(id: string, markedAt: number): void {
  const sheets = loadPaperSheets();
  const idx = sheets.findIndex((s) => s.id === id);
  if (idx < 0) return;
  sheets[idx] = { ...sheets[idx], markedAt };
  writePaperSheets(sheets);
}

// ── The QR payload — a sheet made self-describing ────────────────────────

/** What the printed QR carries: enough to mark the sheet on any device
 *  with the same pack active. Deliberately no answers — the marking
 *  device grades from its own copy of the bank. */
export interface PaperPayload {
  v: 1;
  /** Active pack id — marking on a device with a different pack active
   *  is refused rather than mis-recorded. */
  pack: string;
  id: string;
  code: string;
  cat: string;
  /** createdAt, unix ms. */
  t: number;
  qs: string[];
}

export function payloadFromSheet(sheet: PaperSheet, packId: string): PaperPayload {
  return {
    v: 1,
    pack: packId,
    id: sheet.id,
    code: sheet.code,
    cat: sheet.categoryKey,
    t: sheet.createdAt,
    qs: sheet.questionIds,
  };
}

export function sheetFromPayload(payload: PaperPayload): PaperSheet {
  return {
    id: payload.id,
    code: payload.code,
    createdAt: payload.t,
    categoryKey: payload.cat,
    questionIds: payload.qs,
  };
}

/** Unicode-safe base64url (the `#s=` fragment the QR encodes). */
export function encodePaperPayload(payload: PaperPayload): string {
  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict decode — anything malformed returns null rather than throwing,
 *  so a mangled URL degrades to a clear "can't read this sheet" screen. */
export function decodePaperPayload(encoded: string): PaperPayload | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    const raw: unknown = JSON.parse(json);
    if (typeof raw !== 'object' || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (
      p.v !== 1 ||
      typeof p.pack !== 'string' ||
      typeof p.id !== 'string' ||
      typeof p.code !== 'string' ||
      typeof p.cat !== 'string' ||
      typeof p.t !== 'number' ||
      !Array.isArray(p.qs) ||
      p.qs.length === 0 ||
      !p.qs.every((q): q is string => typeof q === 'string')
    ) {
      return null;
    }
    return {
      v: 1,
      pack: p.pack,
      id: p.id,
      code: p.code,
      cat: p.cat,
      t: p.t,
      qs: p.qs,
    };
  } catch {
    return null;
  }
}

// ── Marking: sheet + written letters → engine rows ───────────────────────

/** One row of the marking screen: the question (when the active pack
 *  still has it) and the letters the learner wrote (null = no answer). */
export interface PaperMark {
  questionId: string;
  question: PackQuestion | null;
  selected: OptionKey[] | null;
}

/** Join a sheet's question ids back to the active bank. Ids the pack no
 *  longer has stay in the list (question: null) so the marking screen
 *  can say so instead of silently renumbering. */
export function resolveSheetQuestions(
  questionIds: string[],
  bank: PackQuestion[],
): PaperMark[] {
  const byId = new Map(bank.map((q) => [q.id, q]));
  return questionIds.map((questionId) => ({
    questionId,
    question: byId.get(questionId) ?? null,
    selected: null,
  }));
}

export interface PaperResultRows {
  session: Session;
  attempts: Attempt[];
  correctCount: number;
  answeredCount: number;
  /** Markable questions left without an answer — the learner can come
   *  back for them; re-opening the sheet pre-fills what was entered. */
  blankCount: number;
}

/**
 * Build the engine rows for a marked sheet. Skipped questions (no
 * letters written) produce no attempt — like abandoning mid-session.
 *
 * Ids are deterministic: the session IS the sheet (session.id =
 * sheet.id) and each attempt is `<sheet.id>:a<position>` — so a re-mark,
 * on this device or another one, upserts the same rows via the sync
 * layer's idempotent upserts instead of double-counting the sheet.
 *
 * answeredAt is the MARKING time (we don't know when the learner sat
 * it), staggered by 1ms per row so per-question ordering stays stable,
 * and timeTakenSeconds is 1 — the documented "unmeasured" sentinel.
 * A sheet can be marked in batches (a few questions today, the rest
 * tomorrow): `priorAnsweredAt` (attempt id → answeredAt of the rows
 * already stored) keeps an earlier batch on its own day, so re-marking
 * never moves streak credit — only rows entered for the first time get
 * stamped `now`.
 */
export function buildPaperResult(
  sheet: PaperSheet,
  marks: PaperMark[],
  now: number,
  priorAnsweredAt?: ReadonlyMap<string, number>,
): PaperResultRows {
  const attempts: Attempt[] = [];
  let correctCount = 0;
  marks.forEach((mark, i) => {
    if (!mark.question || !mark.selected || mark.selected.length === 0) return;
    const isCorrect = gradeSelection(mark.question, mark.selected);
    if (isCorrect) correctCount++;
    const id = `${sheet.id}:a${i + 1}`;
    attempts.push({
      id,
      sessionId: sheet.id,
      questionId: mark.question.id,
      answeredAt: priorAnsweredAt?.get(id) ?? now + i,
      selectedAnswer: [...mark.selected].sort().join(','),
      isCorrect,
      timeTakenSeconds: 1, // unmeasured — the sheet keeps no clock
      subject: mark.question.categoryKey,
      topic: mark.question.id, // per-question rescue, same as on-screen
      difficulty: mark.question.difficulty,
      position: i + 1,
      mode: 'paper',
      ...(mark.question.scenarioId ? { scenarioId: mark.question.scenarioId } : {}),
      ...(APP_BUILD ? { appBuild: APP_BUILD } : {}),
    });
  });
  const session: Session = {
    id: sheet.id,
    subject: sheet.categoryKey,
    startedAt: sheet.createdAt,
    endedAt: now + marks.length,
    questionCount: marks.length,
    correctCount,
    mode: 'paper',
    ...(APP_BUILD ? { appBuild: APP_BUILD } : {}),
    ...deviceContext(),
  };
  const markable = marks.filter((m) => m.question !== null).length;
  return {
    session,
    attempts,
    correctCount,
    answeredCount: attempts.length,
    blankCount: markable - attempts.length,
  };
}

/** Answer-box hint printed under a question. */
export function answerBoxLabel(question: PackQuestion): string {
  // Deliberately no count for multi-answer — the screen runner doesn't
  // reveal how many are correct either.
  return isMultiAnswer(question) ? 'Write ALL the correct letters' : 'Write the letter';
}
