'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatest } from '@/lib/useLatest';

/** Quiet typing time before a note is written. */
export const NOTE_SAVE_DEBOUNCE_MS = 600;
/** How long the "Saved ✓" confirmation stays up after a write. */
export const NOTE_SAVED_FLASH_MS = 800;

export interface DebouncedNoteOptions {
  /**
   * Hold an emptied draft locally instead of passing it to `onSave`. For a
   * list where saving '' would delete the row under the learner's cursor —
   * the Notes page deletes via its button instead. Off by default: the
   * answer panel's row treats cleared text as "delete the note".
   */
  keepEmpty?: boolean;
}

export interface DebouncedNote {
  /** What the textarea shows: the draft while editing, else the stored text. */
  text: string;
  /** Textarea onChange: updates the draft and (re)starts the save debounce. */
  setText: (value: string) => void;
  /** True once the learner has typed — the draft overlays the stored text. */
  editing: boolean;
  /** True for NOTE_SAVED_FLASH_MS after each write. */
  savedFlash: boolean;
}

/**
 * The one debounce-save behaviour behind every editable note textarea —
 * the NoteRow in the answer panel and the cards on the Notes page.
 *
 * State model: `stored` (the note as persisted, re-read live by the
 * caller's storage hook) is the source of truth; a `draft` (null = not
 * editing) overlays it while typing, so there's no state-syncing effect.
 * Key the consuming component by question id so the draft resets when the
 * question changes. Each keystroke restarts the NOTE_SAVE_DEBOUNCE_MS
 * timer; when it fires the draft goes to `onSave` and "Saved ✓" flashes
 * for NOTE_SAVED_FLASH_MS. A save still pending when the component
 * unmounts (Next tapped mid-debounce, the page left) is written at once
 * rather than lost.
 */
export function useDebouncedNote(
  stored: string | undefined,
  onSave: (text: string) => void,
  opts: DebouncedNoteOptions = {},
): DebouncedNote {
  const [draft, setDraft] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The draft awaiting a write, or null when nothing is pending. Kept in a
  // ref (not read from `draft`) so the unmount flush sees the latest value.
  const pending = useRef<string | null>(null);
  const latestSave = useLatest(onSave);
  const latestOpts = useLatest(opts);

  /** Write the pending draft now, if there is one. */
  const flush = useCallback(
    (flash: boolean) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const value = pending.current;
      pending.current = null;
      if (value === null) return;
      if (latestOpts.current.keepEmpty && value.trim() === '') return;
      latestSave.current(value);
      if (!flash) return;
      setSavedFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        flashTimer.current = null;
        setSavedFlash(false);
      }, NOTE_SAVED_FLASH_MS);
    },
    [latestOpts, latestSave],
  );

  const setText = useCallback(
    (value: string) => {
      setDraft(value);
      pending.current = value;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flush(true), NOTE_SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Unmount: write what's pending (no flash — nothing left to show it on)
  // and drop the flash timer.
  useEffect(
    () => () => {
      flush(false);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [flush],
  );

  return {
    text: draft ?? stored ?? '',
    setText,
    editing: draft !== null,
    savedFlash,
  };
}
