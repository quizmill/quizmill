'use client';

import { useRef, useState } from 'react';
import { FileDown, FileUp, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { APP_CONFIG } from '@/config';
import { pushAllToCloud } from '@/lib/sync';
import {
  applyTransferPayload,
  buildExportPayload,
  exportFileName,
  parseTransferPayload,
} from '@/lib/transfer';

/**
 * "Backup & transfer" card — file export/import of the active pack's
 * progress. Works with NO backend configured (it's the serverless way to
 * move to a new device or keep an offline backup), and composes with any
 * sync backend: an import re-pushes to the cloud when signed in.
 */
export function TransferSettings() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleExport() {
    setError(null);
    const payload = buildExportPayload();
    const counts = payload.data;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(payload.packId, payload.exportedAt);
    a.click();
    URL.revokeObjectURL(url);
    setStatus(
      `Exported ${counts.sessions.length} session(s), ${counts.attempts.length} answer(s), ` +
        `${counts.achievements.length} sticker(s), and ${counts.votes.length} vote(s).`,
    );
  }

  async function handleImportFile(file: File) {
    setError(null);
    setStatus(null);
    const parsed = parseTransferPayload(await file.text(), APP_CONFIG.packId);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const { data } = parsed.payload;
    const changed = applyTransferPayload(parsed.payload);
    // If a sync backend is signed in, the imported rows are new local
    // writes from the cloud's perspective — send them up too.
    if (changed) pushAllToCloud();
    setStatus(
      changed
        ? `Imported ${data.sessions.length} session(s) and ${data.attempts.length} answer(s). ` +
            'Existing progress was kept; duplicates were merged.'
        : 'Nothing new in that file — this device already has all of it.',
    );
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <HardDrive className="h-5 w-5 text-ink-400" />
        <h2 className="text-lg font-semibold text-ink-900">Backup & transfer</h2>
      </div>
      <p className="mt-1 text-sm text-ink-600">
        Save your progress to a file, or restore one exported on another
        device. Importing adds to what's here — it never deletes anything.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" onClick={handleExport}>
          <FileDown className="h-4 w-4" />
          Export progress
        </Button>
        <Button variant="secondary" onClick={() => fileInput.current?.click()}>
          <FileUp className="h-4 w-4" />
          Import from file
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="transfer-import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // allow re-importing the same file
            if (file) void handleImportFile(file);
          }}
        />
      </div>

      {status && (
        <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          {status}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-warn-100/60 px-3 py-2 text-sm text-warn-700">
          {error}
        </p>
      )}
    </div>
  );
}
