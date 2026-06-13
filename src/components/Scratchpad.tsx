'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, NotebookPen, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { loadScratchpad, saveScratchpad } from '@/lib/storage';

/**
 * A collapsible working space for the practice/review runners — somewhere
 * to jot calculations or thoughts while answering a longer question.
 *
 * Notes live in localStorage (per pack, never synced), so they survive
 * moving between questions and an accidental reload; the only thing that
 * empties the pad is the Clear button (or a full data reset in Settings).
 * The open/closed state is remembered too, so a learner who likes it open
 * isn't re-opening it every question.
 *
 * Hydrates after mount — storage reads need `window`, and reading during
 * the static export would desync the first paint.
 */
export function Scratchpad() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const saved = loadScratchpad();
    setText(saved.text);
    setOpen(saved.open);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    saveScratchpad({ text, open: next });
  }

  function handleChange(value: string) {
    setText(value);
    saveScratchpad({ text: value, open });
  }

  function clear() {
    setText('');
    saveScratchpad({ text: '', open });
    textareaRef.current?.focus();
  }

  const hasNotes = text.trim().length > 0;

  return (
    <section data-testid="scratchpad" className="flex flex-col">
      <button
        type="button"
        data-testid="scratchpad-toggle"
        aria-expanded={open}
        onClick={toggle}
        className="tap-feedback inline-flex w-fit items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-600 shadow-sm transition hover:border-brand-300"
      >
        <NotebookPen className="h-4 w-4" />
        Scratchpad
        {hasNotes && !open ? (
          <span
            data-testid="scratchpad-dot"
            className="h-1.5 w-1.5 rounded-full bg-brand-500"
            aria-label="has notes"
          />
        ) : null}
        <ChevronDown
          className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div className="mt-2 flex flex-col gap-1.5 rounded-2xl border border-ink-200 bg-white p-3 shadow-sm">
          <textarea
            ref={textareaRef}
            data-testid="scratchpad-text"
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            rows={4}
            placeholder="Jot down your working, calculations, or notes…"
            className="w-full resize-y rounded-lg border border-ink-200 bg-ink-50/40 px-3 py-2 font-mono text-sm leading-relaxed text-ink-800 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none"
          />
          <div className="flex items-center justify-between text-xs text-ink-400">
            <span>Saved on this device — only you can see it.</span>
            <button
              type="button"
              data-testid="scratchpad-clear"
              onClick={clear}
              disabled={!hasNotes}
              className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-ink-500 transition hover:bg-ink-100 disabled:pointer-events-none disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
