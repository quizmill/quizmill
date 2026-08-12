'use client';

import { useEffect, useState } from 'react';
import { Cloud, CloudOff, LogOut, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSyncStatus } from '@/lib/useStorage';
import {
  OTP_MAX_LENGTH,
  isOtpLongEnough,
  sanitiseOtpInput,
} from '@/lib/otp';
import { type ComponentType } from 'react';
import { SYNC_CONFIGURED, authRedirectUrl, getSupabase } from '@/lib/supabase';
import { syncBackendKind } from '@/lib/syncBackend';
import { SyncKeySettings } from '@/components/SyncKeySettings';
import { SyncBackendFooter, SyncStatusLine } from '@/components/SyncStatusLine';

// Each backend brings its own sign-in UI, registered by kind. Custom
// backend providers (see registerSyncBackendProvider in
// src/lib/syncBackend.ts) register their card here the same way.
const settingsCards: Record<string, ComponentType> = {
  http: SyncKeySettings,
  supabase: SupabaseSyncSettings,
};

/** Register the Settings card for a custom sync backend kind. Call from
 *  module scope alongside registerSyncBackendProvider. */
export function registerSyncSettingsCard(kind: string, card: ComponentType): void {
  settingsCards[kind] = card;
}

/**
 * "Sync across devices" card for the Settings page — renders the card
 * registered for whichever backend this build is wired to (see
 * src/lib/syncBackend.ts), or nothing when sync isn't configured.
 */
export function SyncSettings() {
  const kind = syncBackendKind();
  const Card = kind ? settingsCards[kind] : undefined;
  return Card ? <Card /> : null;
}

/**
 * Supabase card: optional passwordless sign-in — purely to turn on cloud
 * sync. The app stays fully usable signed out; nothing here gates the rest
 * of the experience.
 *
 * Sign-in is a one-time **code** (alphanumeric, configurable length) typed
 * back into the app, not a tapped link. On iOS an email link opens in
 * Safari, whose storage is separate from an installed (home-screen) PWA —
 * so the link would sign Safari in but leave the PWA signed out. Entering
 * the code authenticates *this* app directly. The same email still carries
 * a link, which is convenient on desktop.
 */
function SupabaseSyncSettings() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sync = useSyncStatus();

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setReady(true);
      return;
    }
    let active = true;
    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSignedInAs(data.session?.user.email ?? null);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setSignedInAs(session?.user.email ?? null);
      if (session) {
        setStatus(null);
        setCodeSent(false);
        setCode('');
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Hidden entirely when this build has no Supabase project configured.
  if (!SYNC_CONFIGURED) return null;

  async function sendCode() {
    const sb = getSupabase();
    if (!sb || !email.trim()) return;
    setSending(true);
    setError(null);
    setStatus(null);
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: authRedirectUrl() },
    });
    setSending(false);
    if (error) {
      setError(error.message);
    } else {
      setCodeSent(true);
      setStatus(`We emailed a code to ${email.trim()}. Enter it below.`);
    }
  }

  async function verifyCode() {
    const sb = getSupabase();
    if (!sb || !isOtpLongEnough(code)) return;
    setVerifying(true);
    setError(null);
    const { error } = await sb.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setVerifying(false);
    // On success, onAuthStateChange flips the card to signed-in.
    if (error) setError(error.message);
  }

  function reset() {
    setCodeSent(false);
    setCode('');
    setError(null);
    setStatus(null);
  }

  async function signOut() {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
    setStatus('Signed out. Your progress stays on this device.');
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        {signedInAs ? (
          <Cloud className="h-5 w-5 text-brand-600" />
        ) : (
          <CloudOff className="h-5 w-5 text-ink-400" />
        )}
        <h2 className="text-lg font-semibold text-ink-900">Sync across devices</h2>
      </div>

      {!ready ? (
        <p className="mt-2 text-sm text-ink-500">Loading…</p>
      ) : signedInAs ? (
        <>
          <p className="mt-1 text-sm text-ink-600">
            Signed in as <strong>{signedInAs}</strong>. Your progress syncs
            automatically to your other devices.
          </p>
          <SyncStatusLine state={sync.state} pending={sync.pending} />
          <Button variant="secondary" className="mt-6" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-600">
            Sign in to carry progress between the iPad and other devices.
            Optional — everything works offline on this device either way.
          </p>
          {!codeSent ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="parent@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex-1 rounded-xl border border-ink-200 px-3 py-2 text-sm text-ink-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
              <Button onClick={sendCode} disabled={sending || !email.trim()}>
                <Mail className="h-4 w-4" />
                {sending ? 'Sending…' : 'Email me a code'}
              </Button>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={OTP_MAX_LENGTH}
                  placeholder="Enter the code"
                  data-testid="otp-input"
                  value={code}
                  onChange={(e) => setCode(sanitiseOtpInput(e.target.value))}
                  className="flex-1 rounded-xl border border-ink-200 px-3 py-2 text-center font-mono text-lg tracking-[0.35em] text-ink-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
                <Button onClick={verifyCode} disabled={verifying || !isOtpLongEnough(code)}>
                  {verifying ? 'Verifying…' : 'Verify'}
                </Button>
              </div>
              <button
                type="button"
                onClick={reset}
                className="self-start text-xs text-ink-500 underline-offset-2 hover:underline"
              >
                Use a different email
              </button>
            </div>
          )}
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

