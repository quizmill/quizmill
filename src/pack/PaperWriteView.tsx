'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ClipboardCheck,
  Eraser,
  Hand,
  PenLine,
  Trash2,
  Undo2,
} from 'lucide-react';
import { QrCode } from '@/components/QrCode';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { PaperSheet } from '@/pack/paper';
import {
  addInkPoint,
  choosePageWidth,
  eraseStrokesAt,
  loadFingerWrites,
  loadSheetInk,
  pageScale,
  saveFingerWrites,
  saveSheetInk,
  strokePath,
  INK_COLORS,
  INK_ERASE_RADIUS,
  INK_WIDTH,
  type InkStroke,
} from '@/pack/paperInk';

type Tool = 'pen' | 'eraser';

/** Undo steps kept — each is a snapshot of the stroke list (the stroke
 *  objects are shared, so a snapshot costs one array). */
const MAX_UNDO = 60;

/** A stroke shorter than this (in samples) is thrown away when a second
 *  finger lands: it was the first finger of a scroll, not writing. */
const SCROLL_GESTURE_GRACE = 8;

const InkPath = memo(function InkPath({ stroke }: { stroke: InkStroke }) {
  return <path d={strokePath(stroke.p)} stroke={stroke.c} data-testid="ink-stroke" />;
});

/**
 * A sheet you write on instead of printing: the worksheet as one long
 * scrolling page with a free-ink layer over the whole of it, for a
 * tablet and a pencil (or a finger). The learner works down the page
 * writing letters in the answer boxes and scribbling working wherever
 * there is room; when they are done, someone enters the answers on
 * another device by scanning the QR at the foot of the page — the same
 * loop as a printout, without the printer.
 *
 * Input rules (the part that makes it feel like paper):
 *  - a stylus always writes, and a mouse does too;
 *  - a finger writes or scrolls according to the toolbar toggle — it
 *    starts as "writes" so a tablet without a pencil just works, and
 *    the first stylus contact flips it to "scrolls" (write with the
 *    pencil, move the page with the other hand);
 *  - while fingers write, two fingers scroll;
 *  - touches are ignored while the stylus is down (a resting palm).
 *
 * The page keeps a fixed layout width and is scaled to fit (see
 * paperInk.ts), ink is an SVG overlay in that layout's coordinates —
 * no canvas, so a 20-question page never hits a canvas size limit — and
 * every stroke is saved to this device as it lands.
 */
export function PaperWriteView({
  sheet,
  markUrl,
  onClose,
  children,
}: {
  sheet: PaperSheet;
  /** Deep link the QR encodes (null while it is being built). */
  markUrl: string | null;
  onClose: () => void;
  /** The worksheet layout the ink goes over. */
  children: React.ReactNode;
}) {
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  // Layout width the stored strokes were written against (null = none
  // yet: the page is free to take the viewport's width).
  const [inkWidth, setInkWidth] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>(INK_COLORS[0]);
  const [fingerWrites, setFingerWrites] = useState(true);
  const [undoDepth, setUndoDepth] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const livePathRef = useRef<SVGPathElement>(null);

  // Pointer handlers run between renders — they read the latest values
  // through refs rather than closing over a stale render.
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const fingerWritesRef = useRef(fingerWrites);
  fingerWritesRef.current = fingerWrites;

  const historyRef = useRef<InkStroke[][]>([]);
  /** The stroke being written right now. */
  const liveRef = useRef<{ pointerId: number; touch: boolean; p: number[] } | null>(null);
  /** An eraser drag in progress (pointer id), and whether it has
   *  already pushed its undo snapshot. */
  const erasingRef = useRef<{ pointerId: number; snapshotted: boolean } | null>(null);
  const penDownRef = useRef(false);
  /** Fingers currently on the page (pointer id → last clientY). */
  const touchesRef = useRef(new Map<number, number>());
  /** Two-finger scroll in progress — no writing until every finger lifts. */
  const panningRef = useRef(false);

  const pageWidth = inkWidth ?? choosePageWidth(available);
  const scale = pageScale(pageWidth, available);

  // ── Load, persist ──────────────────────────────────────────────────────

  useEffect(() => {
    const ink = loadSheetInk(sheet.id);
    setStrokes(ink?.strokes ?? []);
    setInkWidth(ink?.w ?? null);
    historyRef.current = [];
    setUndoDepth(0);
    setFingerWrites(loadFingerWrites());
    setLoaded(true);
  }, [sheet.id]);

  /** Replace the stroke list: remember the old one for Undo, pin the
   *  layout width on the first stroke, and save. */
  const commit = useCallback(
    (next: InkStroke[], opts: { snapshot?: boolean } = {}) => {
      if (opts.snapshot !== false) {
        historyRef.current = [...historyRef.current, strokesRef.current].slice(-MAX_UNDO);
        setUndoDepth(historyRef.current.length);
      }
      // An emptied sheet lets go of its layout width again.
      const width = next.length === 0 ? null : (inkWidth ?? pageWidth);
      strokesRef.current = next;
      setStrokes(next);
      setInkWidth(width);
      setSaveFailed(!saveSheetInk(sheet.id, { v: 1, w: width ?? pageWidth, strokes: next }));
    },
    [inkWidth, pageWidth, sheet.id],
  );

  // ── Layout: width available, page height ───────────────────────────────

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => {
      // Leave a little air either side of the page on wide screens.
      const gutter = scroller.clientWidth >= 640 ? 32 : 12;
      setAvailable(Math.max(0, scroller.clientWidth - gutter));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const measure = () => setPageHeight(page.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // Images arrive late and a rotation re-wraps an ink-free page.
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [pageWidth, loaded]);

  // The app page underneath must not scroll while the sheet is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Scrolling vs writing ───────────────────────────────────────────────
  //
  // Fingers scroll natively when they aren't writing (touch-action:
  // pan-y), which a stylus would do too — so stylus touches are
  // cancelled at touchstart, the one place a page can still refuse a
  // scroll. React's touch listeners are passive; these must not be.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const isStylus = (ev: TouchEvent) =>
      penDownRef.current ||
      Array.from(ev.changedTouches).some(
        (t) => (t as Touch & { touchType?: string }).touchType === 'stylus',
      );
    const onTouchStart = (ev: TouchEvent) => {
      if (fingerWritesRef.current || isStylus(ev)) ev.preventDefault();
    };
    const onTouchMove = (ev: TouchEvent) => {
      if (liveRef.current || erasingRef.current || panningRef.current || isStylus(ev)) {
        ev.preventDefault();
      }
    };
    surface.addEventListener('touchstart', onTouchStart, { passive: false });
    surface.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      surface.removeEventListener('touchstart', onTouchStart);
      surface.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  // ── Pointer → ink ──────────────────────────────────────────────────────

  /** Client coordinates → page px (the layout the strokes live in). */
  const toPage = (clientX: number, clientY: number): [number, number] => {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return [clientX, clientY];
    // The rect is the SCALED box; a zero width only happens without
    // layout (tests), where client coordinates are taken as page ones.
    const s = rect.width > 0 ? rect.width / pageWidth : 1;
    return [(clientX - rect.left) / s, (clientY - rect.top) / s];
  };

  const drawLive = () => {
    const live = liveRef.current;
    livePathRef.current?.setAttribute('d', live ? strokePath(live.p) : '');
  };

  const abandonLive = () => {
    liveRef.current = null;
    drawLive();
  };

  const eraseAt = (pointerId: number, x: number, y: number) => {
    const next = eraseStrokesAt(strokesRef.current, x, y, INK_ERASE_RADIUS);
    if (next === strokesRef.current) return;
    const erasing = erasingRef.current;
    // One Undo step per rub, however many strokes it takes out.
    commit(next, { snapshot: !(erasing && erasing.pointerId === pointerId && erasing.snapshotted) });
    if (erasing) erasing.snapshotted = true;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const isTouch = e.pointerType === 'touch';
    if (e.pointerType === 'pen') {
      penDownRef.current = true;
      // A palm that landed first was not writing.
      if (liveRef.current?.touch) abandonLive();
      if (fingerWritesRef.current) {
        // First pencil contact: from here on, fingers move the page.
        setFingerWrites(false);
        fingerWritesRef.current = false;
        saveFingerWrites(false);
        setNotice('Pencil spotted — a finger now scrolls the page.');
      }
    } else if (isTouch) {
      touchesRef.current.set(e.pointerId, e.clientY);
      if (!fingerWritesRef.current || penDownRef.current) return;
      if (touchesRef.current.size >= 2) {
        // Second finger: this is a scroll. Drop the mark the first
        // finger had only just begun.
        panningRef.current = true;
        const live = liveRef.current;
        if (live && live.p.length / 2 <= SCROLL_GESTURE_GRACE) abandonLive();
        erasingRef.current = null;
        return;
      }
      if (panningRef.current) return;
    } else if (e.button !== 0) {
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // not every environment supports capture
    }
    const [x, y] = toPage(e.clientX, e.clientY);
    if (toolRef.current === 'eraser') {
      erasingRef.current = { pointerId: e.pointerId, snapshotted: false };
      eraseAt(e.pointerId, x, y);
      return;
    }
    const p: number[] = [];
    addInkPoint(p, x, y);
    liveRef.current = { pointerId: e.pointerId, touch: isTouch, p };
    livePathRef.current?.setAttribute('stroke', colorRef.current);
    drawLive();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' && touchesRef.current.has(e.pointerId)) {
      const lastY = touchesRef.current.get(e.pointerId) ?? e.clientY;
      touchesRef.current.set(e.pointerId, e.clientY);
      if (panningRef.current) {
        // Each finger reports its own movement; halve it so two fingers
        // moving together scroll the page 1:1.
        const scroller = scrollerRef.current;
        if (scroller) {
          scroller.scrollTop -= (e.clientY - lastY) / Math.max(1, touchesRef.current.size);
        }
        return;
      }
    }
    if (erasingRef.current?.pointerId === e.pointerId) {
      const [x, y] = toPage(e.clientX, e.clientY);
      eraseAt(e.pointerId, x, y);
      return;
    }
    const live = liveRef.current;
    if (!live || live.pointerId !== e.pointerId) return;
    // A pencil samples faster than the frame rate; the in-between
    // samples are what keep fast handwriting round.
    const native = e.nativeEvent;
    const samples =
      typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    let moved = false;
    for (const s of samples.length > 0 ? samples : [native]) {
      const [x, y] = toPage(s.clientX, s.clientY);
      if (addInkPoint(live.p, x, y)) moved = true;
    }
    if (moved) drawLive();
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (e.pointerType === 'pen') penDownRef.current = false;
    if (e.pointerType === 'touch') {
      touchesRef.current.delete(e.pointerId);
      if (touchesRef.current.size === 0) panningRef.current = false;
    }
    if (erasingRef.current?.pointerId === e.pointerId) erasingRef.current = null;
    const live = liveRef.current;
    if (!live || live.pointerId !== e.pointerId) return;
    liveRef.current = null;
    drawLive();
    // A cancelled finger stroke was the browser taking the touch over
    // (a scroll); a cancelled pencil stroke is still handwriting.
    if (cancelled && live.touch) return;
    commit([...strokesRef.current, { c: colorRef.current, p: live.p }]);
  };

  // ── Toolbar actions ────────────────────────────────────────────────────

  const undo = () => {
    const previous = historyRef.current.pop();
    setUndoDepth(historyRef.current.length);
    if (previous) commit(previous, { snapshot: false });
  };

  const clearAll = () => {
    if (strokesRef.current.length === 0) return;
    if (!window.confirm('Rub out everything written on this sheet?')) return;
    commit([]);
  };

  const toggleFinger = () => {
    const next = !fingerWrites;
    setFingerWrites(next);
    saveFingerWrites(next);
  };

  const toolButton =
    'tap-feedback inline-flex h-10 min-w-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-40';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-ink-100"
      data-testid="paper-write"
      role="dialog"
      aria-modal="true"
      aria-label={`Sheet ${sheet.code} — write on screen`}
    >
      <div className="flex flex-shrink-0 flex-col border-b border-ink-200 bg-surface shadow-sm">
        <div className="mx-auto flex w-full max-w-[932px] items-center gap-1 px-2 py-1.5">
          <button
            type="button"
            onClick={onClose}
            data-testid="write-done"
            className={cn(toolButton, 'text-ink-700 hover:bg-ink-100')}
          >
            <ArrowLeft className="h-4 w-4" />
            Done
          </button>
          <span className="hidden font-mono text-sm font-bold text-ink-500 sm:inline">
            {sheet.code}
          </span>
          <span className="flex-1" />
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Pen colour">
            {INK_COLORS.map((c, i) => {
              const active = tool === 'pen' && color === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={['Black pen', 'Blue pen', 'Red pen'][i]}
                  data-testid={`ink-color-${i}`}
                  onClick={() => {
                    setColor(c);
                    setTool('pen');
                  }}
                  className={cn(
                    'tap-feedback flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full',
                    active ? 'bg-ink-100' : 'hover:bg-ink-100',
                  )}
                >
                  <span
                    className={cn(
                      'rounded-full border-2 border-surface shadow-sm transition-all',
                      active ? 'h-6 w-6 ring-2 ring-ink-500' : 'h-5 w-5',
                    )}
                    style={{ backgroundColor: c }}
                  />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-pressed={tool === 'eraser'}
            aria-label="Eraser"
            data-testid="ink-eraser"
            onClick={() => setTool(tool === 'eraser' ? 'pen' : 'eraser')}
            className={cn(
              toolButton,
              tool === 'eraser'
                ? 'bg-brand-600 text-white'
                : 'text-ink-600 hover:bg-ink-100',
            )}
          >
            <Eraser className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Undo"
            data-testid="ink-undo"
            onClick={undo}
            disabled={undoDepth === 0}
            className={cn(toolButton, 'text-ink-600 hover:bg-ink-100')}
          >
            <Undo2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Rub out everything"
            data-testid="ink-clear"
            onClick={clearAll}
            disabled={strokes.length === 0}
            className={cn(toolButton, 'text-ink-600 hover:bg-ink-100')}
          >
            <Trash2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-pressed={fingerWrites}
            aria-label={fingerWrites ? 'Finger writes — tap to make it scroll' : 'Finger scrolls — tap to make it write'}
            data-testid="ink-finger"
            onClick={toggleFinger}
            className={cn(
              toolButton,
              'border',
              fingerWrites
                ? 'border-brand-500/40 bg-brand-50 text-brand-800'
                : 'border-ink-200 text-ink-600 hover:bg-ink-100',
            )}
          >
            {fingerWrites ? <PenLine className="h-4 w-4" /> : <Hand className="h-4 w-4" />}
            <span className="hidden sm:inline">
              Finger {fingerWrites ? 'writes' : 'scrolls'}
            </span>
          </button>
        </div>
        <p
          className={cn(
            'px-3 pb-1.5 text-center text-xs',
            saveFailed ? 'font-semibold text-warn-600' : 'text-ink-500',
          )}
          data-testid="ink-hint"
          aria-live="polite"
        >
          {saveFailed
            ? 'This device is out of storage — what you write now is not being saved.'
            : (notice ??
              (fingerWrites
                ? 'Write with a finger or a pencil · scroll with two fingers'
                : 'Write with the pencil · scroll with a finger'))}
        </p>
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="write-scroller"
      >
        <div className="flex flex-col items-center gap-5 px-1.5 py-3 sm:px-4 sm:py-5">
          {/* The frame takes the page's SCALED size in the flow; the page
              inside is laid out at its fixed width and scaled to fit. */}
          <div
            className="relative"
            style={{ width: pageWidth * scale, height: pageHeight * scale }}
          >
            <div
              ref={pageRef}
              className="absolute left-0 top-0 origin-top-left select-none [-webkit-touch-callout:none]"
              style={{ width: pageWidth, transform: `scale(${scale})` }}
              data-testid="write-page"
            >
              {children}
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                fill="none"
                strokeWidth={INK_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                data-testid="ink-layer"
              >
                {strokes.map((s, i) => (
                  // Strokes are immutable once committed, so the memoised
                  // path only rebuilds its `d` when a stroke is new here.
                  <InkPath key={`${i}:${s.p.length}:${s.p[0]}:${s.p[1]}`} stroke={s} />
                ))}
                <path ref={livePathRef} d="" />
              </svg>
              <div
                ref={surfaceRef}
                className={cn(
                  'absolute inset-0',
                  tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair',
                )}
                style={{ touchAction: fingerWrites ? 'none' : 'pan-y pinch-zoom' }}
                data-testid="ink-surface"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => endPointer(e, false)}
                onPointerCancel={(e) => endPointer(e, true)}
              />
            </div>
          </div>

          <div
            className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border border-ink-200 bg-surface p-5 text-center shadow-sm"
            data-testid="write-finish"
          >
            <h2 className="text-lg font-semibold text-ink-900">Finished?</h2>
            <p className="text-sm text-ink-600">
              Keep this sheet open and scan the code with another phone or
              tablet to enter the answers — just like marking a printout.
            </p>
            {markUrl ? (
              <div className="rounded-xl bg-white p-1 text-neutral-900">
                <QrCode value={markUrl} className="h-48 w-48" />
              </div>
            ) : null}
            <span className="font-mono text-sm font-bold text-ink-700">{sheet.code}</span>
            <Button
              variant="secondary"
              block
              data-testid="write-mark-here"
              onClick={() => {
                window.location.href = `mark/#sheet=${encodeURIComponent(sheet.id)}`;
              }}
            >
              <ClipboardCheck className="h-4 w-4" />
              Enter the answers on this device
            </Button>
            <p className="text-xs text-ink-500">
              What you wrote stays on this device, saved as you go — come
              back to the sheet any time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
