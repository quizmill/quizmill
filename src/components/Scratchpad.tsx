'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  ChevronDown,
  Maximize2,
  Minimize2,
  NotebookPen,
  Pencil,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  DEFAULT_PEN_COLOR,
  EMPTY_SCRATCHPAD,
  loadScratchpad,
  saveScratchpad,
  type Scratchpad as ScratchpadData,
  type ScratchpadMode,
  type ScratchStroke,
} from '@/lib/storage';

/**
 * A collapsible working space for the practice/review runners, with two
 * tabs: **Write** (a textarea) and **Draw** (a freehand canvas) — for
 * jotting calculations, working, or quick diagrams on a longer question.
 *
 * Everything lives in localStorage (per pack, never synced): typed notes as
 * text, drawings as vector strokes (normalised points, so they redraw at any
 * size and stay tiny). Notes survive moving between questions and a reload;
 * only Clear (or a full reset in Settings) empties them, and the open tab is
 * remembered. Hydrates after mount — storage reads need `window`.
 *
 * The canvas is hand-rolled on Pointer Events (one path for mouse, touch and
 * stylus) to keep the dependency-light, offline-first footprint.
 */

// On-palette pen colours (canvas needs real values, not Tailwind classes):
// ink-800 (the shared default), brand-500, warn-500, success-500.
const PEN_COLORS = [DEFAULT_PEN_COLOR, '#3b78e0', '#c97b1a', '#2f9e6e'];
const PEN_WIDTH = 2.5;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function Scratchpad() {
  const [data, setData] = useState<ScratchpadData>(EMPTY_SCRATCHPAD);
  // Full-screen view of the open panel — a transient view preference, so it's
  // kept in component state only (not persisted with the pad's contents).
  const [expanded, setExpanded] = useState(false);

  // Mirror the latest data so the canvas pointer handlers (which don't
  // re-render mid-stroke) always commit against current state.
  const dataRef = useRef(data);
  dataRef.current = data;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<ScratchStroke | null>(null);
  // Canvas box, captured on pointerdown — it can't change mid-stroke, so we
  // avoid a layout read on every pointermove.
  const rectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    setData(loadScratchpad());
  }, []);

  function commit(next: ScratchpadData) {
    setData(next);
    saveScratchpad(next);
  }

  // ---- canvas sizing + replay ----
  // Re-runs when the Draw tab becomes visible (and on resize): match the
  // backing store to the CSS box at devicePixelRatio, then replay strokes.
  useEffect(() => {
    if (!data.open || data.mode !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      replay(ctx, rect.width, rect.height, dataRef.current.strokes);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
    // `expanded` changes the canvas box, so re-fit and replay when it toggles.
  }, [data.open, data.mode, expanded]);

  // While full-screen: lock background scroll and let Escape exit.
  useEffect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  function redrawNow(strokes: ScratchStroke[]) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    replay(ctx, rect.width, rect.height, strokes);
  }

  function normPoint(clientX: number, clientY: number, rect: DOMRect) {
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not all environments support capture */
    }
    const rect = canvas.getBoundingClientRect();
    rectRef.current = rect;
    const penColor = dataRef.current.color;
    const p = normPoint(e.clientX, e.clientY, rect);
    strokeRef.current = { color: penColor, points: [p] };
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = PEN_WIDTH;
    ctx.strokeStyle = penColor;
    ctx.beginPath();
    ctx.moveTo(p.x * rect.width, p.y * rect.height);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!strokeRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const rect = rectRef.current;
    if (!canvas || !ctx || !rect) return;
    const p = normPoint(e.clientX, e.clientY, rect);
    strokeRef.current.points.push(p);
    ctx.lineTo(p.x * rect.width, p.y * rect.height);
    ctx.stroke();
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (!stroke) return;
    const strokes = [...dataRef.current.strokes, stroke];
    commit({ ...dataRef.current, strokes });
    // A tap is a single point — replay so it shows as a dot.
    if (stroke.points.length === 1) redrawNow(strokes);
  }

  function undo() {
    const strokes = dataRef.current.strokes.slice(0, -1);
    commit({ ...dataRef.current, strokes });
    redrawNow(strokes);
  }

  function clearDrawing() {
    commit({ ...dataRef.current, strokes: [] });
    redrawNow([]);
  }

  function handleText(text: string) {
    commit({ ...dataRef.current, text });
  }

  function clearText() {
    commit({ ...dataRef.current, text: '' });
    textareaRef.current?.focus();
  }

  function setMode(mode: ScratchpadMode) {
    commit({ ...dataRef.current, mode });
  }

  function setColor(color: string) {
    commit({ ...dataRef.current, color });
  }

  function toggleOpen() {
    const open = !dataRef.current.open;
    if (!open) setExpanded(false); // don't re-open straight into full screen
    commit({ ...dataRef.current, open });
  }

  const hasNotes = data.text.trim().length > 0 || data.strokes.length > 0;

  const tabs = (
    <div className="flex gap-1 rounded-lg bg-ink-100 p-1">
      <TabButton
        testid="scratchpad-tab-write"
        icon={Type}
        label="Write"
        active={data.mode === 'write'}
        onClick={() => setMode('write')}
      />
      <TabButton
        testid="scratchpad-tab-draw"
        icon={Pencil}
        label="Draw"
        active={data.mode === 'draw'}
        onClick={() => setMode('draw')}
      />
    </div>
  );

  function writeBody(full: boolean) {
    return (
      <>
        <textarea
          ref={textareaRef}
          data-testid="scratchpad-text"
          value={data.text}
          onChange={(e) => handleText(e.target.value)}
          rows={full ? undefined : 4}
          placeholder="Jot down your working, calculations, or notes…"
          className={cn(
            'w-full rounded-lg border border-ink-200 bg-ink-50/40 px-3 py-2 font-mono text-sm leading-relaxed text-ink-800 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none',
            full ? 'min-h-0 flex-1 resize-none' : 'resize-y',
          )}
        />
        <div className="flex items-center justify-between text-xs text-ink-400">
          <span>Saved on this device — only you can see it.</span>
          <button
            type="button"
            data-testid="scratchpad-clear"
            onClick={clearText}
            disabled={data.text.length === 0}
            className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-ink-500 transition hover:bg-ink-100 disabled:pointer-events-none disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </>
    );
  }

  function drawBody(full: boolean) {
    return (
      <>
        <canvas
          ref={canvasRef}
          data-testid="scratchpad-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={cn(
            // Static paper background: saved strokes carry fixed pen
            // colours (incl. near-black ink), so the canvas can't go dark.
            'w-full touch-none rounded-lg border border-ink-200 bg-night-50',
            full ? 'min-h-0 flex-1' : 'h-48',
          )}
          style={{ touchAction: 'none' }}
        />
        <div className="flex items-center justify-between gap-2">
          <div
            className="flex items-center gap-1.5"
            data-testid="scratchpad-palette"
          >
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Pen colour ${c}`}
                aria-pressed={data.color === c}
                onClick={() => setColor(c)}
                className={cn(
                  'h-6 w-6 rounded-full border-2 transition',
                  data.color === c
                    ? 'scale-110 border-ink-500'
                    : 'border-surface shadow-sm',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1 text-xs text-ink-500">
            <button
              type="button"
              data-testid="scratchpad-undo"
              onClick={undo}
              disabled={data.strokes.length === 0}
              className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium transition hover:bg-ink-100 disabled:pointer-events-none disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </button>
            <button
              type="button"
              data-testid="scratchpad-clear-draw"
              onClick={clearDrawing}
              disabled={data.strokes.length === 0}
              className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium transition hover:bg-ink-100 disabled:pointer-events-none disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
        </div>
        {full ? null : (
          <span className="text-xs text-ink-400">
            Saved on this device — only you can see it.
          </span>
        )}
      </>
    );
  }

  return (
    <section data-testid="scratchpad" className="flex flex-col">
      <button
        type="button"
        data-testid="scratchpad-toggle"
        aria-expanded={data.open}
        onClick={toggleOpen}
        className="tap-feedback inline-flex w-fit items-center gap-1.5 rounded-full border border-ink-200 bg-surface px-3 py-1.5 text-sm font-medium text-ink-600 shadow-sm transition hover:border-brand-300"
      >
        <NotebookPen className="h-4 w-4" />
        Scratchpad
        {hasNotes && !data.open ? (
          <span
            data-testid="scratchpad-dot"
            className="h-1.5 w-1.5 rounded-full bg-brand-500"
            aria-label="has notes"
          />
        ) : null}
        <ChevronDown
          className={cn('h-4 w-4 transition-transform', data.open && 'rotate-180')}
        />
      </button>

      {data.open && !expanded ? (
        <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-ink-200 bg-surface p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="flex-1">{tabs}</div>
            <button
              type="button"
              data-testid="scratchpad-expand"
              aria-label="Full screen"
              onClick={() => setExpanded(true)}
              className="tap-feedback inline-flex items-center justify-center rounded-lg border border-ink-200 p-2 text-ink-500 transition hover:bg-ink-100"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
          {data.mode === 'write' ? writeBody(false) : drawBody(false)}
        </div>
      ) : null}

      {data.open && expanded ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Scratchpad"
          data-testid="scratchpad-fullscreen"
          className="fixed inset-0 z-50 flex flex-col gap-2 bg-surface p-4"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-800">
              <NotebookPen className="h-4 w-4" />
              Scratchpad
            </span>
            <button
              type="button"
              data-testid="scratchpad-collapse"
              aria-label="Exit full screen"
              onClick={() => setExpanded(false)}
              className="tap-feedback inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-600 transition hover:bg-ink-100"
            >
              <Minimize2 className="h-4 w-4" />
              Close
            </button>
          </div>
          {tabs}
          {data.mode === 'write' ? writeBody(true) : drawBody(true)}
        </div>
      ) : null}
    </section>
  );
}

/** Replay vector strokes onto a context whose box is w×h CSS px. */
function replay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  strokes: readonly ScratchStroke[],
) {
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = PEN_WIDTH;
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    ctx.strokeStyle = stroke.color;
    ctx.beginPath();
    stroke.points.forEach((p, i) => {
      const x = p.x * w;
      const y = p.y * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    // Single-point stroke (a tap): nudge so round-cap renders a dot.
    if (stroke.points.length === 1) {
      ctx.lineTo(stroke.points[0].x * w + 0.01, stroke.points[0].y * h + 0.01);
    }
    ctx.stroke();
  }
}

function TabButton({
  testid,
  icon: Icon,
  label,
  active,
  onClick,
}: {
  testid: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'tap-feedback inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
        active
          ? 'bg-surface text-ink-900 shadow-sm'
          : 'text-ink-500 hover:text-ink-700',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
