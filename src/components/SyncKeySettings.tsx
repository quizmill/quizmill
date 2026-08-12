'use client';

import { useEffect, useState } from 'react';
import { Check, Cloud, CloudOff, Copy, Eye, EyeOff, KeyRound, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SyncStatusLine } from '@/components/SyncStatusLine';
import { useSyncStatus } from '@/lib/useStorage';
import {
  clearSyncKey,
  getStoredSyncKey,
  setSyncKey,
} from '@/lib/backends/workerBackend';
import { generateSyncKey, isValidSyncKey, maskSyncKey } from '@/lib/syncKey';

/**
 * "Sync across devices" card for the Cloudflare Worker backend. No email,
 * no accounts: the device holds a random sync key, and entering the same
 * key on another device links the two. The app stays fully usable without
 * a key; nothing here gates the rest of the experience.
 *
 * A freshly-created key is shown revealed with a "save this" nudge — it
 * exists nowhere but this device until the user writes it down or enters
 * it elsewhere.
 */
export function SyncKeySettings() {
  const [key, setKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [justCreated, setJustCreated] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [entering, setEntering] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const sync = useSyncStatus();

  useEffect(() => {
    setKey(getStoredSyncKey());
    setReady(true);
  }, []);

  async function createKey() {
    const fresh = generateSyncKey();
    await setSyncKey(fresh);
    setKey(fresh);
    setJustCreated(true);
    setRevealed(true);
    setError(null);
    setStatus(null);
  }

  async function linkWithKey() {
    setError(null);
    if (!isValidSyncKey(entering)) {
      setError("That doesn't look like a sync key — it has 20 letters/digits, like QM-ABCDE-FGH23-JKMNP-QRSTV.");
      return;
    }
    const ok = await setSyncKey(entering);
    if (!ok) {
      setError('Could not store the key on this device.');
      return;
    }
    setKey(getStoredSyncKey());
    setEntering('');
    setJustCreated(false);
    setRevealed(false);
    setStatus('Linked! Your history from other devices is on its way.');
  }

  async function copyKey() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (http, permissions) — reveal instead
      // so the user can copy by hand.
      setRevealed(true);
    }
  }

  async function stopSyncing() {
    await clearSyncKey();
    setKey(null);
    setJustCreated(false);
    setRevealed(false);
    setStatus('Sync is off. Your progress stays on this device.');
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        {key ? (
          <Cloud className="h-5 w-5 text-brand-600" />
        ) : (
          <CloudOff className="h-5 w-5 text-ink-400" />
        )}
        <h2 className="text-lg font-semibold text-ink-900">Sync across devices</h2>
      </div>

      {!ready ? (
        <p className="mt-2 text-sm text-ink-500">Loading…</p>
      ) : key ? (
        <>
          <p className="mt-1 text-sm text-ink-600">
            Sync is on. Enter this key in the same app on another device to
            share your progress with it.
          </p>
          {justCreated && (
            <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
              Save this key somewhere safe (a password manager is perfect) —
              it exists only on this device and is the only way to link
              another one.
            </p>
          )}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code
              data-testid="sync-key"
              className="flex-1 rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 text-center font-mono text-sm tracking-wider text-ink-800"
            >
              {revealed ? key : maskSyncKey(key)}
            </code>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setRevealed((r) => !r)}>
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {revealed ? 'Hide' : 'Show'}
              </Button>
              <Button variant="secondary" onClick={copyKey}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <SyncStatusLine state={sync.state} pending={sync.pending} />
          <Button variant="secondary" className="mt-6" onClick={stopSyncing}>
            <LogOut className="h-4 w-4" />
            Turn off sync on this device
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-600">
            Carry progress between the iPad and other devices with a sync
            key — no account or email needed. Optional; everything works
            offline on this device either way.
          </p>
          <Button className="mt-4" onClick={createKey}>
            <KeyRound className="h-4 w-4" />
            Create a sync key
          </Button>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-400">
            Already have a key from another device?
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="QM-XXXXX-XXXXX-XXXXX-XXXXX"
              data-testid="sync-key-input"
              value={entering}
              onChange={(e) => setEntering(e.target.value)}
              className="flex-1 rounded-xl border border-ink-200 px-3 py-2 text-center font-mono text-sm tracking-wider text-ink-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            <Button
              variant="secondary"
              onClick={linkWithKey}
              disabled={!entering.trim()}
            >
              Link this device
            </Button>
          </div>
        </>
      )}

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
