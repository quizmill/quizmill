'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  Cloud,
  CloudOff,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  Mail,
  Share2,
  UserRound,
} from 'lucide-react';
import { Button, buttonStyles } from '@/components/ui/Button';
import { SyncBackendFooter, SyncStatusLine } from '@/components/SyncStatusLine';
import { APP_CONFIG } from '@/config';
import { useSyncStatus } from '@/lib/useStorage';
import {
  clearSyncKey,
  getStoredKeyName,
  getStoredSyncKey,
  reconcileKeyName,
  saveKeyName,
  setSyncKey,
} from '@/lib/backends/httpBackend';
import {
  MAX_KEY_NAME_LENGTH,
  generateSyncKey,
  isValidSyncKey,
  maskSyncKey,
  syncKeyMailto,
} from '@/lib/syncKey';

/**
 * "Sync across devices" card for the HTTP sync backend (Cloudflare Worker
 * or any server speaking the protocol — docs/sync-protocol.md). No email,
 * no accounts: the device holds a random sync key, and entering the same
 * key on another device links the two. The app stays fully usable without
 * a key; nothing here gates the rest of the experience.
 *
 * A freshly-created key is shown revealed with a "save this" nudge — it
 * exists nowhere but this device until the user writes it down or enters
 * it elsewhere.
 *
 * A key can also carry a name ("Leo", "Dad's key"). Keys are unguessable
 * noise by design, so a household running several of them can't otherwise
 * tell which app is syncing whose history. The name rides along with the
 * key on the server, so it shows up on every device that enters it.
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
  // The key's optional name: cached locally for instant render, then
  // refreshed from the server (which may know a name this device doesn't).
  const [name, setName] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  // Web Share API availability — read after mount (SSR renders without it).
  const [canShare, setCanShare] = useState(false);
  const sync = useSyncStatus();

  useEffect(() => {
    const stored = getStoredSyncKey();
    setKey(stored);
    setName(getStoredKeyName());
    setCanShare(typeof navigator !== 'undefined' && Boolean(navigator.share));
    setReady(true);
    if (!stored) return;
    let live = true;
    reconcileKeyName().then((n) => {
      if (live) setName(n);
    });
    return () => {
      live = false;
    };
  }, []);

  async function createKey() {
    const fresh = generateSyncKey();
    await setSyncKey(fresh);
    setKey(fresh);
    setName(null);
    setJustCreated(true);
    setRevealed(true);
    setError(null);
    setStatus(null);
    // Naming is most useful at exactly this moment — a second key in the
    // house is indistinguishable from the first without one.
    setDraft('');
    setNaming(true);
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
    // If the key was named elsewhere, say so — it's the confirmation that
    // you linked the right one.
    const linkedName = await reconcileKeyName();
    setName(linkedName);
    if (linkedName) {
      setStatus(`Linked to “${linkedName}”. That history is on its way to this device.`);
    }
  }

  function startNaming() {
    setDraft(name ?? '');
    setError(null);
    setStatus(null);
    setNaming(true);
  }

  async function commitName() {
    setSavingName(true);
    const { name: saved, synced } = await saveKeyName(draft);
    setSavingName(false);
    setName(saved);
    setNaming(false);
    if (!saved) {
      setStatus('Name removed.');
    } else if (synced) {
      setStatus(`This key is now “${saved}” — your other devices will show the name too.`);
    } else {
      setStatus(
        `Named “${saved}” on this device. We couldn't reach the sync server, so other devices will pick the name up later.`,
      );
    }
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

  async function shareKey() {
    if (!key) return;
    const label = name ? ` (${name})` : '';
    try {
      await navigator.share({
        title: `${APP_CONFIG.title} — sync key${label}`,
        text: `Sync key${label} for ${APP_CONFIG.title}: ${key}\nEnter it in Settings → Sync across devices.`,
      });
    } catch {
      // user dismissed the share sheet — nothing to do
    }
  }

  async function stopSyncing() {
    await clearSyncKey();
    setKey(null);
    setName(null);
    setNaming(false);
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
        <h3 className="text-lg font-semibold text-ink-900">Sync across devices</h3>
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
              Save this key now — it exists only on this device and is the
              only way to link another one. Easiest: email it to yourself
              below, or pop it in a password manager.
            </p>
          )}

          {/* Whose key is this? Optional, but the only way to tell two
              keys apart once they're both in the family password manager. */}
          {naming ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={MAX_KEY_NAME_LENGTH}
                placeholder="Whose key is this? e.g. Leo"
                data-testid="sync-key-name-input"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitName();
                  if (e.key === 'Escape') setNaming(false);
                }}
                className="flex-1 rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
              <div className="flex gap-2">
                <Button onClick={commitName} disabled={savingName}>
                  {savingName ? 'Saving…' : 'Save name'}
                </Button>
                <Button variant="secondary" onClick={() => setNaming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {name ? (
                <span
                  data-testid="sync-key-name"
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-brand-800"
                >
                  <UserRound className="h-4 w-4" />
                  <strong className="font-semibold">{name}</strong>
                </span>
              ) : (
                <span className="text-ink-500">This key isn't named yet.</span>
              )}
              <button
                type="button"
                onClick={startNaming}
                data-testid="sync-key-name-edit"
                className="text-xs text-ink-500 underline-offset-2 hover:underline"
              >
                {name ? 'Rename' : 'Name this key'}
              </button>
            </div>
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
          <div className="mt-2 flex flex-wrap gap-2">
            {/* Recovery without infrastructure: opens the user's OWN mail
                app with the key pre-filled — no server ever sees it.
                Losing every device then just means searching your inbox.
                The name rides along so two keys don't look alike there. */}
            <a
              href={syncKeyMailto(key, APP_CONFIG.title, name)}
              className={buttonStyles({ variant: 'secondary', size: 'md' })}
            >
              <Mail className="h-4 w-4" />
              Email me this key
            </a>
            {canShare && (
              <Button variant="secondary" onClick={shareKey}>
                <Share2 className="h-4 w-4" />
                Share
              </Button>
            )}
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
      <SyncBackendFooter />
    </div>
  );
}
