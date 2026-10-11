'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LicenceKeyForm } from '@/components/LicenceKeyForm';
import { readKeyFromHash, stripKeyFromLocation, unlockConfig } from '@/lib/unlock';
import { useClientState, useMounted } from '@/lib/useMounted';

// The key the URL carried, read once per page load and remembered: the
// read also wipes the fragment, and React re-invokes client reads in dev
// strict mode, so a second read would find nothing.
let urlKey: string | null | undefined;
function takeUrlKey(): string | null {
  if (urlKey === undefined) {
    urlKey = readKeyFromHash(window.location.hash);
    stripKeyFromLocation();
  }
  return urlKey;
}

/** Test seam — forget the remembered key so each test starts clean. */
export function resetUnlockPageForTests(): void {
  urlKey = undefined;
}

/**
 * `/unlock#key=…` — the one-tap path for a learner holding a licence key:
 * the key is read from the FRAGMENT (never the query string: fragments
 * reach no server and no log), wiped from the address bar at once, and
 * submitted for them; a success lands on Home with the unlocked pack
 * active, a refusal stays here with the endpoint's words and the file
 * fallback.
 *
 * The key is also shown with a Copy button, because on iOS a link from
 * outside always opens in Safari while an installed app keeps its own
 * storage — the key is the bridge: copy it, open the app, paste it under
 * Packs → Have a licence key?
 *
 * The route exists in every build and gates on the ACTIVE pack at render
 * time: a pack with no unlock endpoint gets a plain explanation.
 */
export function UnlockPage() {
  const mounted = useMounted();
  const config = unlockConfig();
  // Read after mount: SSG has no location, and the prerender must not
  // differ from the first client paint.
  const [key, setKey] = useClientState(takeUrlKey, null);
  const [copied, setCopied] = useState(false);

  // A second link tapped while this page is open is a fragment-only
  // navigation (no load) — pick its key up the same way.
  useEffect(() => {
    const onHash = () => {
      const next = readKeyFromHash(window.location.hash);
      stripKeyFromLocation();
      if (next) {
        urlKey = next;
        setKey(next);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [setKey]);

  async function copy() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no clipboard access — the key is still selectable on screen
    }
  }

  return (
    <main className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
      </header>

      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold text-ink-900">
          <KeyRound className="h-7 w-7 text-brand-600" />
          Unlock a pack
        </h1>
        <p className="mt-1 text-ink-500">
          {config
            ? 'A licence key fetches the pack it unlocks and makes it active on this device.'
            : 'This pack has no licence unlock.'}
        </p>
      </div>

      {!config ? (
        <section
          data-testid="unlock-unavailable"
          className="rounded-2xl border border-ink-200 bg-surface p-5 text-sm text-ink-600 shadow-xs"
        >
          The active pack does not take licence keys. You can still insert a pack
          from its files under{' '}
          <Link href="/packs" className="underline">
            Packs
          </Link>
          .
        </section>
      ) : (
        <>
          {mounted && key ? (
            <section
              data-testid="unlock-key"
              className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-xs"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                Your licence key
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code
                  data-testid="unlock-key-value"
                  className="min-w-0 flex-1 select-all break-all rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-800"
                >
                  {key}
                </code>
                <Button size="sm" variant="secondary" onClick={() => void copy()} data-testid="unlock-key-copy">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="mt-3 text-xs text-ink-600">
                Installed the app on your home screen? Paste this key under Packs →
                Enter a licence key.
              </p>
            </section>
          ) : null}

          <section className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-xs">
            <h2 className="text-lg font-semibold text-ink-900">Enter a licence key</h2>
            <p className="mt-1 text-sm text-ink-600">
              {key
                ? 'The key from your link is filled in below.'
                : 'Paste the licence key you were given.'}
            </p>
            <div className="mt-4">
              {/* Keyed on the URL key so a key arriving after mount starts a
                  fresh form that submits it once. */}
              {mounted ? (
                <LicenceKeyForm key={key ?? ''} config={config} autoKey={key ?? undefined} />
              ) : null}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
