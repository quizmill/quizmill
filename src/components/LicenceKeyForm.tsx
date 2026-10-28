'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { buildTimeManifest } from '@/pack/source';
import {
  UNLOCK_FALLBACK,
  openUnlockedPack,
  unlockPack,
  type UnlockConfig,
  type UnlockOutcome,
} from '@/lib/unlock';

/** Cap the validation errors shown for a bundle the endpoint sent broken. */
const MAX_ERRORS_SHOWN = 4;

type UnlockFailure = Extract<UnlockOutcome, { ok: false }>;
type UnlockedEntry = Extract<UnlockOutcome, { ok: true }>['entry'];

/** One licence-key unlock: its state, and the submit that drives it. */
export interface LicenceUnlock {
  busy: boolean;
  failure: UnlockFailure | null;
  /** The unlocked pack, once in — ready for a full load to Home. */
  done: UnlockedEntry | null;
  submit: (candidate: string) => Promise<void>;
}

/**
 * The ONE handler behind every licence-key entry. A key that arrived by
 * URL (`autoKey`) is submitted once on mount. A success loads Home, after
 * `holdMs` when the caller shows the confirmation for a beat first.
 * `deferNavigation` lets a URL-key caller wait for an explicit action instead.
 * Unmounting (a newer key remounts the form on /unlock; leaving the page)
 * abandons the request in flight: whatever the endpoint answers afterwards
 * must not insert or activate anything. A success is terminal: no second
 * submit, and unmounting during the hold loads Home at once.
 */
export function useLicenceUnlock(
  config: UnlockConfig,
  { autoKey, holdMs = 0, deferNavigation = false }: {
    autoKey?: string;
    holdMs?: number;
    deferNavigation?: boolean;
  } = {},
): LicenceUnlock {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UnlockFailure | null>(null);
  const [done, setDone] = useState<UnlockedEntry | null>(null);
  const started = useRef(false);
  const inflight = useRef<AbortController | null>(null);
  const leaving = useRef<{ timer: ReturnType<typeof setTimeout>; entry: UnlockedEntry } | null>(
    null,
  );
  // Set synchronously on success: the unlock is terminal from there on.
  const succeeded = useRef(false);
  useEffect(
    () => () => {
      inflight.current?.abort();
      // Leaving mid-hold (e.g. a tap on Home): the pack is already active,
      // so finish the full load now rather than strand the old pack's content.
      const pending = leaving.current;
      if (pending) {
        leaving.current = null;
        clearTimeout(pending.timer);
        openUnlockedPack(pending.entry);
      }
    },
    [],
  );

  async function submit(candidate: string) {
    const trimmed = candidate.trim();
    if (!trimmed || busy || succeeded.current) return;
    setBusy(true);
    setFailure(null);
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const outcome = await unlockPack(trimmed, {
        config,
        buildPackId: buildTimeManifest.id,
        signal: controller.signal,
      });
      if (!outcome.ok) {
        // Abandoned, not failed: the newer form has the learner's attention.
        if (outcome.reason !== 'cancelled') setFailure(outcome);
        return;
      }
      succeeded.current = true;
      setDone(outcome.entry);
      if (deferNavigation) return;
      if (holdMs > 0) {
        const timer = setTimeout(() => {
          leaving.current = null;
          openUnlockedPack(outcome.entry);
        }, holdMs);
        leaving.current = { timer, entry: outcome.entry };
      } else {
        openUnlockedPack(outcome.entry);
      }
    } finally {
      if (inflight.current === controller) inflight.current = null;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoKey || started.current) return;
    started.current = true;
    void submit(autoKey);
    // Runs once for the key the URL carried — never again on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey]);

  return { busy, failure, done, submit };
}

/**
 * Licence key entry — the field, its button and the outcome, shown right
 * here, where the learner is: a failure stays in the form with the
 * endpoint's text and the file fallback; a success says so on the way to
 * Home, so the unlocked pack is the first thing on screen with no Packs
 * visit in between.
 */
export function LicenceKeyEntry({
  unlock,
  initialKey,
}: {
  unlock: LicenceUnlock;
  /** Kept in the field, e.g. the key from the URL. */
  initialKey?: string;
}) {
  const [key, setKey] = useState(initialKey ?? '');
  const { busy, failure, done, submit } = unlock;

  return (
    <div data-testid="licence-key-form">
      <div className="flex gap-2">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit(key);
          }}
          placeholder="Your licence key"
          aria-label="Licence key"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          data-testid="licence-key-input"
          className="min-w-0 flex-1 rounded-xl border border-ink-200 bg-surface px-3 py-2 font-mono text-sm text-ink-800 placeholder:font-sans placeholder:text-ink-400 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
        />
        <Button
          size="sm"
          onClick={() => void submit(key)}
          disabled={busy || !!done || !key.trim()}
          data-testid="licence-key-go"
        >
          {busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </div>

      {done ? (
        <p data-testid="licence-key-done" className="mt-3 text-sm text-brand-800">
          Unlocked “{done.title}” — opening it…
        </p>
      ) : null}

      {failure ? (
        <div
          data-testid="licence-key-error"
          role="alert"
          className="mt-4 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3 text-sm text-ink-800"
        >
          <p className="font-semibold">{failure.message}</p>
          {failure.errors && failure.errors.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {failure.errors.slice(0, MAX_ERRORS_SHOWN).map((e) => (
                <li key={e}>{e}</li>
              ))}
              {failure.errors.length > MAX_ERRORS_SHOWN ? (
                <li className="list-none text-ink-500">
                  …and {failure.errors.length - MAX_ERRORS_SHOWN} more.
                </li>
              ) : null}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-ink-600">
            <Link href="/packs" className="underline">
              {UNLOCK_FALLBACK}
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The key form on its own — "Have a licence key?" on /packs (typed or
 * pasted). /unlock drives the same hook and entry itself, so it can show
 * a calm unlocking state in place of the form.
 */
export function LicenceKeyForm({ config, autoKey }: { config: UnlockConfig; autoKey?: string }) {
  const unlock = useLicenceUnlock(config, { autoKey });
  return <LicenceKeyEntry unlock={unlock} initialKey={autoKey} />;
}
