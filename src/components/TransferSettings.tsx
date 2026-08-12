'use client';

import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useImportProgress, useStorageData } from '@/lib/useStorage';
import { exportProgressFile, TransferError } from '@/lib/transfer';

/**
 * Settings card: move progress between devices as a file.
 *
 * Export shares/downloads a JSON snapshot of everything stored for this
 * pack; Import merges a snapshot from another device (same last-write-wins
 * rules as a cloud pull, so it's safe to import twice or into a device
 * that already has progress).
 */
export function TransferSettings() {
  const { sessions, attempts } = useStorageData();
  const importProgress = useImportProgress();
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);

  async function handleExport() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await exportProgressFile();
      if (outcome === 'shared') {
        setNotice({ kind: 'ok', text: 'Progress file shared.' });
      } else if (outcome === 'downloaded') {
        setNotice({ kind: 'ok', text: 'Progress file downloaded.' });
      }
      // 'cancelled' — the user closed the share sheet; say nothing.
    } catch {
      setNotice({ kind: 'error', text: 'Export failed — please try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile(file: File) {
    setBusy(true);
    setNotice(null);
    try {
      const result = importProgress(await file.text());
      if (!result.changed) {
        setNotice({
          kind: 'ok',
          text: 'Nothing new to import — this device already has all of that progress.',
        });
      } else {
        const { added } = result;
        const parts = [
          added.sessions > 0 ? `${added.sessions} session(s)` : null,
          added.attempts > 0 ? `${added.attempts} answer(s)` : null,
          added.achievements > 0 ? `${added.achievements} sticker(s)` : null,
          added.votes > 0 ? `${added.votes} vote(s)` : null,
        ].filter(Boolean);
        setNotice({
          kind: 'ok',
          text: parts.length > 0
            ? `Imported ${parts.join(', ')}.`
            : 'Import merged updates into existing progress.',
        });
      }
    } catch (err) {
      setNotice({
        kind: 'error',
        text:
          err instanceof TransferError
            ? err.message
            : "Couldn't read that file — please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-ink-900">Move progress</h2>
      <p className="mt-1 text-sm text-ink-600">
        Export saves all sessions, answers, stickers and votes to a file you
        can send to another device. Import merges a file exported from this
        pack — nothing on this device is lost.
      </p>
      {notice ? (
        <p
          data-testid="transfer-notice"
          className={
            notice.kind === 'error'
              ? 'mt-3 rounded-xl border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-sm text-ink-800'
              : 'mt-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800'
          }
        >
          {notice.text}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          data-testid="export-progress"
          onClick={handleExport}
          disabled={busy || sessions.length + attempts.length === 0}
        >
          <Download className="h-4 w-4" />
          Export to file
        </Button>
        <Button
          variant="secondary"
          data-testid="import-progress"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          <Upload className="h-4 w-4" />
          Import from file
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="import-progress-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Allow re-picking the same file after a failed/repeat import.
            e.target.value = '';
            if (file) void handleImportFile(file);
          }}
        />
      </div>
    </div>
  );
}
