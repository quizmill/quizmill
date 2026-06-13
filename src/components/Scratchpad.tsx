'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  ChevronDown,
  NotebookPen,
  Pencil,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
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
// ink-800, brand-500, warn-500, success-500.
const PEN_COLORS = ['#1c2029', '#3b78e0', '#c97b1a', '#2f9e6e'];
const PEN_WIDTH = 2.5;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function Scratchpad() {
  const [data, setData] = useState<ScratchpadData>(EMPTY_SCRATCHPAD);
  const [color, setColor] = useState(PEN_COLORS[0]);

  // Mirror the latest data so the canvas pointer handlers (which don't
  // re-render mid-stroke) always commit against current state.
  const dataRef = useRef(data);
  dataRef.current = data;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<ScratchStroke | null>(null);

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
  }, [data.open, data.mode]);

  function redrawNow(strokes: ScratchStroke[]) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    replay(ctx, rect.width, rect.height, strokes);
  }

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
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
    const p = pointFrom(e);
    strokeRef.current = { color, points: [p] };
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = PEN_WIDTH;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x * rect.width, p.y * rect.height);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!strokeRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const p = pointFrom(e);
    strokeRef.current.points.push(p);
    const rect = canvas.getBoundingClientRect();
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

  function toggleOpen() {
    commit({ ...dataRef.current, open: !dataRef.current.open });
  }

  const hasNotes = data.text.trim().length > 0 || data.strokes.length > 0;

  return (
    <section data-testid="scratchpad" className="flex flex-col">
      <button
        type="button"
        data-testid="scratchpad-toggle"
        aria-expanded={data.open}
        onClick={toggleOpen}
        className="tap-feedback inline-flex w-fit items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-600 shadow-sm transition hover:border-brand-300"
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

      {data.open ? (
        <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-ink-200 bg-white p-3 shadow-sm">
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

          {data.mode === 'write' ? (
            <>
              <textarea
                ref={textareaRef}
                data-testid="scratchpad-text"
                value={data.text}
                onChange={(e) => handleText(e.target.value)}
                rows={4}
                placeholder="Jot down your working, calculations, or notes…"
                className="w-full resize-y rounded-lg border border-ink-200 bg-ink-50/40 px-3 py-2 font-mono text-sm leading-relaxed text-ink-800 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none"
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
          ) : (
            <>
              <canvas
                ref={canvasRef}
                data-testid="scratchpad-canvas"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="h-48 w-full touch-none rounded-lg border border-ink-200 bg-ink-50/40"
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
                      aria-pressed={color === c}
                      onClick={() => setColor(c)}
                      className={cn(
                        'h-6 w-6 rounded-full border-2 transition',
                        color === c
                          ? 'scale-110 border-ink-500'
                          : 'border-white shadow-sm',
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
              <span className="text-xs text-ink-400">
                Saved on this device — only you can see it.
              </span>
            </>
          )}
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
          ? 'bg-white text-ink-900 shadow-sm'
          : 'text-ink-500 hover:text-ink-700',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
