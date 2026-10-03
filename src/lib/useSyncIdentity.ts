'use client';

import { useEffect, useState } from 'react';
import {
  getStoredKeyName,
  getStoredSyncKey,
  reconcileKeyName,
} from '@/lib/backends/httpBackend';
import { getSupabase } from '@/lib/supabase';
import { getSyncBackend, syncBackendKind } from '@/lib/syncBackend';
import { normalizeKeyName, syncKeyLabel } from '@/lib/syncKey';
import { useSyncStatus } from '@/lib/useStorage';

/**
 * Whose progress a write on this device lands in — the answer to "am I
 * logged in here?" for screens reached from outside the app (a scanned
 * QR opens in whatever browser the camera hands it to, which may never
 * have seen the learner's sync key).
 *
 *  - `off`      this build has no sync backend: everything is local.
 *  - `unlinked` sync exists, but this device holds no key / session.
 *  - `linked`   writes mirror to `label` — the key's name ("Leo"), a
 *               short fingerprint of an unnamed key (never the key
 *               itself), or the signed-in email.
 */
export type SyncIdentity =
  | { kind: 'off' }
  | { kind: 'unlinked' }
  | { kind: 'linked'; label: string; via: 'key' | 'named-key' | 'account' };

function keyIdentity(key: string, name: string | null): SyncIdentity {
  return {
    kind: 'linked',
    label: syncKeyLabel(key, name),
    via: normalizeKeyName(name ?? '') ? 'named-key' : 'key',
  };
}

/** Null until resolved on the client (SSR and the first paint). */
export function useSyncIdentity(): SyncIdentity | null {
  // Re-resolve when the engine reports a sign-in/out (a key entered or
  // forgotten in another mounted component).
  const { signedIn } = useSyncStatus();
  const [identity, setIdentity] = useState<SyncIdentity | null>(null);

  useEffect(() => {
    let live = true;
    const kind = syncBackendKind();
    if (!kind) {
      setIdentity({ kind: 'off' });
    } else if (kind === 'http') {
      const key = getStoredSyncKey();
      if (!key) {
        setIdentity({ kind: 'unlinked' });
      } else {
        // Cached name first (instant, works offline), then the server's.
        setIdentity(keyIdentity(key, getStoredKeyName()));
        void reconcileKeyName().then((name) => {
          if (live) setIdentity(keyIdentity(key, name));
        });
      }
    } else if (kind === 'supabase') {
      void getSupabase()
        ?.auth.getSession()
        .then(({ data }) => {
          if (!live) return;
          const email = data.session?.user.email;
          setIdentity(
            data.session
              ? { kind: 'linked', label: email ?? 'your account', via: 'account' }
              : { kind: 'unlinked' },
          );
        });
    } else {
      // A custom backend: all the contract offers is "is someone signed in".
      void getSyncBackend()
        ?.getUserId()
        .then((uid) => {
          if (!live) return;
          setIdentity(
            uid
              ? { kind: 'linked', label: 'your account', via: 'account' }
              : { kind: 'unlinked' },
          );
        });
    }
    return () => {
      live = false;
    };
  }, [signedIn]);

  return identity;
}
