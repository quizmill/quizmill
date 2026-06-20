'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface GameShellProps {
  title: string;
  emoji: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Optional status bar below the title — score / move count / etc. */
  status?: React.ReactNode;
}

/**
 * Modal-style wrapper for the mini-games. Centred on screen, dim backdrop,
 * header with game title + close button. Esc to close on desktop. Body
 * scrolls if the content gets tall, but the games are designed to fit a
 * phone viewport in one screen.
 */
export function GameShell({
  title,
  emoji,
  onClose,
  children,
  status,
}: GameShellProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="game-shell"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/60 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl" aria-hidden>
              {emoji}
            </span>
            <h2 className="font-semibold text-ink-900">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close game"
            className="tap-feedback rounded-full p-2 text-ink-500 hover:bg-ink-100"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        {status ? (
          <div className="border-b border-ink-100 px-4 py-2 text-sm text-ink-600">
            {status}
          </div>
        ) : null}
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
