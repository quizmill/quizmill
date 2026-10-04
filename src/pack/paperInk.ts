/**
 * On-screen paper — the ink a learner writes on a sheet shown on a
 * tablet instead of printed. Pure logic + local persistence; the React
 * shell is PaperWriteView.
 *
 * The sheet is laid out at ONE fixed width (`SheetInk.w`, chosen when
 * the first stroke lands) and scaled visually to whatever the viewport
 * is, so text wraps identically after a rotation or a reload and the
 * ink stays on the question it was written against. Strokes are vectors
 * in that layout's CSS px — flat `[x0, y0, x1, y1, …]` arrays rounded
 * to a tenth of a pixel, which keeps a well-scribbled 20-question sheet
 * in the tens of kilobytes.
 *
 * Stored per sheet, on this device only (like the sheets themselves and
 * the Scratchpad — deliberately not synced): the answers are entered by
 * someone LOOKING at this screen, exactly as with a printout, so the
 * ink never needs to travel.
 */

import { KEY_PREFIX } from '@/lib/storage';
import { loadPaperSheets } from '@/pack/paper';

export interface InkStroke {
  /** Pen colour (a real CSS colour — the sheet is always white). */
  c: string;
  /** Flat x,y pairs in page px. A single pair is a dot. */
  p: number[];
}

export interface SheetInk {
  v: 1;
  /** Layout width (CSS px) the strokes were written against. */
  w: number;
  strokes: InkStroke[];
}

/** Near-black ink first (the default), then a blue and a red for
 *  working and corrections. */
export const INK_COLORS = ['#1c2029', '#2a5fc4', '#c0392b'] as const;

/** Stroke width in page px. */
export const INK_WIDTH = 2.2;

/** Points closer than this to the previous one are dropped while
 *  writing — a pencil reports far more samples than a curve needs. */
export const INK_MIN_STEP = 1.2;

/** How close (page px) the eraser must pass to a stroke to remove it. */
export const INK_ERASE_RADIUS = 12;

// The layout width is the viewport's, within these bounds: wide enough
// that a phone still gets a usable sheet, narrow enough that a line of
// text on a landscape tablet stays readable.
export const MIN_PAGE_WIDTH = 340;
export const MAX_PAGE_WIDTH = 760;
/** Widest the page is ever DISPLAYED — past the layout width it is
 *  scaled up (bigger text and boxes), not re-wrapped. */
export const MAX_DISPLAY_WIDTH = 900;

/** Layout width for a fresh (ink-free) sheet in `available` px. */
export function choosePageWidth(available: number): number {
  if (!Number.isFinite(available) || available <= 0) return MAX_PAGE_WIDTH;
  return Math.round(Math.min(MAX_PAGE_WIDTH, Math.max(MIN_PAGE_WIDTH, available)));
}

/** Visual scale that fits a `pageWidth` layout into `available` px. */
export function pageScale(pageWidth: number, available: number): number {
  if (!Number.isFinite(available) || available <= 0 || pageWidth <= 0) return 1;
  return Math.min(available, MAX_DISPLAY_WIDTH) / pageWidth;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Append a point to a stroke's flat array, in place. Returns false (and
 * appends nothing) when it is within INK_MIN_STEP of the last point.
 */
export function addInkPoint(p: number[], x: number, y: number): boolean {
  const n = p.length;
  if (n >= 2) {
    const dx = x - p[n - 2];
    const dy = y - p[n - 1];
    if (dx * dx + dy * dy < INK_MIN_STEP * INK_MIN_STEP) return false;
  }
  p.push(round1(x), round1(y));
  return true;
}

/**
 * SVG path data for a stroke: quadratic curves through the midpoints of
 * consecutive samples (the samples become control points), which turns
 * a polyline into handwriting. One point renders as a dot via a
 * zero-length segment under a round line cap.
 */
export function strokePath(p: readonly number[]): string {
  const n = p.length / 2;
  if (n < 1) return '';
  if (n === 1) return `M${p[0]} ${p[1]}l0.01 0.01`;
  if (n === 2) return `M${p[0]} ${p[1]}L${p[2]} ${p[3]}`;
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const cx = p[i * 2];
    const cy = p[i * 2 + 1];
    const mx = round1((cx + p[i * 2 + 2]) / 2);
    const my = round1((cy + p[i * 2 + 3]) / 2);
    d += `Q${cx} ${cy} ${mx} ${my}`;
  }
  return `${d}L${p[n * 2 - 2]} ${p[n * 2 - 1]}`;
}

/** Squared distance from point (x,y) to segment (ax,ay)-(bx,by). */
function distSqToSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len));
  const px = ax + t * dx - x;
  const py = ay + t * dy - y;
  return px * px + py * py;
}

function strokeNear(stroke: InkStroke, x: number, y: number, radius: number): boolean {
  const { p } = stroke;
  const r2 = radius * radius;
  if (p.length === 2) {
    return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= r2;
  }
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (distSqToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r2) return true;
  }
  return false;
}

/**
 * The eraser rubs out WHOLE strokes — every stroke passing within
 * `radius` of (x,y). Returns the same array when nothing was hit, so a
 * caller can tell (and skip the re-render).
 */
export function eraseStrokesAt(
  strokes: InkStroke[],
  x: number,
  y: number,
  radius: number = INK_ERASE_RADIUS,
): InkStroke[] {
  const kept = strokes.filter((s) => !strokeNear(s, x, y, radius));
  return kept.length === strokes.length ? strokes : kept;
}

// ── Local persistence (per sheet, not synced) ────────────────────────────

const INK_KEY_PREFIX = `${KEY_PREFIX}paperInk.v1.`;

export const sheetInkKey = (sheetId: string) => `${INK_KEY_PREFIX}${sheetId}`;

function isStroke(s: unknown): s is InkStroke {
  if (!s || typeof s !== 'object') return false;
  const r = s as Record<string, unknown>;
  return (
    typeof r.c === 'string' &&
    Array.isArray(r.p) &&
    r.p.length >= 2 &&
    r.p.length % 2 === 0 &&
    r.p.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** The ink stored for a sheet, or null (none, or unreadable — junk in
 *  storage must never break opening the sheet). */
export function loadSheetInk(sheetId: string): SheetInk | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(sheetInkKey(sheetId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const r = parsed as Record<string, unknown>;
    if (typeof r.w !== 'number' || !(r.w > 0) || !Array.isArray(r.strokes)) return null;
    const strokes = r.strokes.filter(isStroke);
    return strokes.length > 0 ? { v: 1, w: r.w, strokes } : null;
  } catch {
    return null;
  }
}

export function hasSheetInk(sheetId: string): boolean {
  return loadSheetInk(sheetId) !== null;
}

/**
 * Persist a sheet's ink (an ink-free sheet stores nothing). Returns
 * false when storage refused it — a full quota — so the screen can say
 * the writing is only held in memory.
 */
export function saveSheetInk(sheetId: string, ink: SheetInk): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (ink.strokes.length === 0) window.localStorage.removeItem(sheetInkKey(sheetId));
    else window.localStorage.setItem(sheetInkKey(sheetId), JSON.stringify(ink));
    return true;
  } catch {
    return false;
  }
}

export function deleteSheetInk(sheetId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(sheetInkKey(sheetId));
  } catch {
    // storage unavailable — nothing to remove
  }
}

/** Drop ink whose sheet is no longer stored (deleted, or aged out of
 *  the MAX_STORED_SHEETS cap) — ink without its sheet can't be shown. */
export function pruneSheetInk(): void {
  if (typeof window === 'undefined') return;
  try {
    const keep = new Set(loadPaperSheets().map((s) => sheetInkKey(s.id)));
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(INK_KEY_PREFIX) && !keep.has(key)) stale.push(key);
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // storage unavailable — nothing to prune
  }
}

// ── Device preference: does a finger write, or scroll? ───────────────────

/**
 * App-level (survives pack swaps), like the other device prefs. A
 * stylus ALWAYS writes; this only decides what a finger does. Default
 * on, so a tablet without a pencil works straight away — the first
 * stylus contact turns it off (fingers then scroll, as on paper under a
 * resting hand), and the toolbar toggle overrides either way.
 */
export const FINGER_WRITES_KEY = 'quizmill.paperInk.fingerWrites.v1';

export function loadFingerWrites(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(FINGER_WRITES_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveFingerWrites(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FINGER_WRITES_KEY, on ? '1' : '0');
  } catch {
    // storage unavailable — the in-page state still applies
  }
}
