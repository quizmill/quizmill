'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Boxes,
  Download,
  FileJson,
  Link as LinkIcon,
  PackagePlus,
  PackageX,
  Play,
  Store,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { APP_CONFIG } from '@/config';
import { buildTimeManifest, buildTimeQuestionCount } from '@/pack/source';
import { packQuestions } from '@/pack/data';
import {
  PACK_LIBRARY_EVENT,
  activatePack,
  ejectPack,
  insertPack,
  listInsertedPacks,
  packProgress,
  type PackLibraryEntry,
} from '@/lib/packLibrary';
import { fetchPackFromUrl, parsePackFiles, type ParseOutcome } from '@/lib/packInsert';
import {
  loadRegistry,
  registryRepoUrl,
  type PackListing,
  type RegistryResult,
} from '@/lib/packRegistry';

/** Cap the validation errors shown for one failed insert — a malformed
 *  600-question bank can produce hundreds. */
const MAX_ERRORS_SHOWN = 6;

function ProgressLine({ packId }: { packId: string }) {
  // Read after mount: SSG renders with no localStorage.
  const [progress, setProgress] = useState<ReturnType<typeof packProgress> | null>(null);
  useEffect(() => setProgress(packProgress(packId)), [packId]);
  if (!progress) return null;
  if (progress.attempts === 0) {
    return <p className="mt-2 text-xs text-ink-500">No progress on this device yet.</p>;
  }
  return (
    <p className="mt-2 text-xs text-ink-500">
      <strong>{progress.sessions}</strong> session{progress.sessions === 1 ? '' : 's'} ·{' '}
      <strong>{progress.attempts}</strong> answer{progress.attempts === 1 ? '' : 's'}
      {progress.lastPractisedAt ? (
        <> · last practised {new Date(progress.lastPractisedAt).toLocaleDateString()}</>
      ) : null}
    </p>
  );
}

function PackCard({
  id,
  title,
  description,
  questionCount,
  categoryCount,
  builtIn,
  active,
  onActivate,
  onEject,
}: {
  id: string;
  title: string;
  description?: string;
  questionCount: number;
  categoryCount?: number;
  builtIn?: boolean;
  active: boolean;
  onActivate?: () => void;
  onEject?: () => void;
}) {
  return (
    <div
      data-testid={`pack-card-${id}`}
      className={
        active
          ? 'rounded-2xl border-2 border-brand-400 bg-surface p-5 shadow-sm'
          : 'rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-ink-900">{title}</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {questionCount} question{questionCount === 1 ? '' : 's'}
            {categoryCount ? (
              <> · {categoryCount} categor{categoryCount === 1 ? 'y' : 'ies'}</>
            ) : null}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {builtIn ? (
            <span className="rounded-full border border-ink-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Built in
            </span>
          ) : null}
          {active ? (
            <span
              data-testid="active-pack-badge"
              className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
            >
              Active
            </span>
          ) : null}
        </div>
      </div>
      {description ? (
        <p className="mt-1.5 line-clamp-2 text-sm text-ink-600">{description}</p>
      ) : null}
      <ProgressLine packId={id} />
      {!active || onEject ? (
        <div className="mt-3 flex items-center gap-2">
          {!active && onActivate ? (
            <Button size="sm" data-testid={`activate-${id}`} onClick={onActivate}>
              <Play className="h-4 w-4" />
              Make active
            </Button>
          ) : null}
          {onEject ? (
            <Button
              size="sm"
              variant="ghost"
              data-testid={`eject-${id}`}
              onClick={onEject}
              className="text-warn-700"
            >
              <PackageX className="h-4 w-4" />
              Eject
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The pack shelf — one installed app, many packs. Lists the built-in pack
 * and every inserted one with its own saved progress, switches the active
 * pack (pointer + reload), ejects packs (progress kept), and inserts new
 * ones from files or a URL.
 */
export function PacksPage() {
  const [entries, setEntries] = useState<PackLibraryEntry[]>([]);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  // The published-pack registry — loaded once on mount, best source wins
  // (website API → raw GitHub → the copy baked into this build).
  const [registry, setRegistry] = useState<RegistryResult | null>(null);
  const [busyRepo, setBusyRepo] = useState<string | null>(null);

  const refresh = useCallback(() => setEntries(listInsertedPacks()), []);
  useEffect(() => {
    refresh();
    setMounted(true);
    window.addEventListener(PACK_LIBRARY_EVENT, refresh);
    let cancelled = false;
    void loadRegistry().then((r) => {
      if (!cancelled) setRegistry(r);
    });
    return () => {
      cancelled = true;
      window.removeEventListener(PACK_LIBRARY_EVENT, refresh);
    };
  }, [refresh]);

  const activeId = APP_CONFIG.packId;
  const buildId = buildTimeManifest.id;
  // A pack handed off by an external host (hash / cloud) is neither built in
  // nor on the shelf — still show it, so "Active" is never invisible.
  const externalActive =
    activeId !== buildId && !entries.some((e) => e.id === activeId);

  function finishInsert(outcome: ParseOutcome, origin: string) {
    if (!outcome.ok) {
      setErrors(outcome.errors);
      return;
    }
    const result = insertPack(outcome.candidate, { origin, buildPackId: buildId });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setMessage(
      `Inserted “${result.entry.title}” (${result.entry.questionCount} questions). Make it active to start practising.`,
    );
    refresh();
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const files = await Promise.all(
        Array.from(list).map(async (f) => ({ name: f.name, text: await f.text() })),
      );
      finishInsert(parsePackFiles(files), files.map((f) => f.name).join(', '));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function handleUrl() {
    if (!url.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      finishInsert(await fetchPackFromUrl(url), url.trim());
      setUrl('');
    } finally {
      setBusy(false);
    }
  }

  async function handleRegistryInsert(listing: PackListing) {
    if (busyRepo) return;
    setBusyRepo(listing.repo);
    setMessage(null);
    try {
      finishInsert(await fetchPackFromUrl(registryRepoUrl(listing)), registryRepoUrl(listing));
    } finally {
      setBusyRepo(null);
    }
  }

  function switchTo(id: string | null, title: string) {
    if (!activatePack(id)) return;
    setMessage(`Switching to “${title}”…`);
    // Any #pack= hash would outrank the pointer on reload — drop it first.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    window.location.reload();
  }

  function handleEject(entry: PackLibraryEntry) {
    const ok = window.confirm(
      `Eject “${entry.title}”?\n\nThe pack is removed from this device, but your progress for it is kept — insert the pack again and you'll pick up where you left off.${
        entry.id === activeId ? '\n\nIt is the active pack, so the app will switch back to the built-in pack.' : ''
      }`,
    );
    if (!ok) return;
    const { wasActive } = ejectPack(entry.id);
    if (wasActive) {
      window.location.reload();
      return;
    }
    setMessage(`Ejected “${entry.title}”. Progress kept.`);
    refresh();
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
          <Boxes className="h-7 w-7 text-brand-600" />
          Packs
        </h1>
        <p className="mt-1 text-ink-500">
          One app, many packs. Insert a pack, practise, swap — each pack&apos;s
          progress stays saved on this device.
        </p>
      </div>

      {message ? (
        <div
          data-testid="packs-message"
          className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800"
        >
          {message}
        </div>
      ) : null}

      <section className="flex flex-col gap-3" data-testid="pack-shelf">
        {externalActive && mounted ? (
          <PackCard
            id={activeId}
            title={APP_CONFIG.title}
            description={APP_CONFIG.description}
            questionCount={packQuestions.length}
            categoryCount={APP_CONFIG.categories.length}
            active
          />
        ) : null}
        <PackCard
          id={buildId}
          title={buildTimeManifest.title}
          description={buildTimeManifest.description}
          questionCount={buildTimeQuestionCount}
          categoryCount={buildTimeManifest.categories.length}
          builtIn
          active={mounted && activeId === buildId}
          onActivate={() => switchTo(null, buildTimeManifest.title)}
        />
        {entries.map((entry) => (
          <PackCard
            key={entry.id}
            id={entry.id}
            title={entry.title}
            description={entry.description}
            questionCount={entry.questionCount}
            categoryCount={entry.categoryCount}
            active={mounted && activeId === entry.id}
            onActivate={() => switchTo(entry.id, entry.title)}
            onEject={() => handleEject(entry)}
          />
        ))}
      </section>

      <section
        data-testid="registry-browser"
        className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
          <Store className="h-5 w-5 text-ink-500" />
          Browse published packs
        </h2>
        <p className="mt-1 text-sm text-ink-600">
          The community pack registry — insert one straight onto your shelf.
          {registry?.source === 'builtin'
            ? ' Offline: showing the copy bundled with this app.'
            : null}
        </p>
        {!registry ? (
          <p className="mt-4 text-sm text-ink-400">Loading the registry…</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-ink-100">
            {registry.listings.map((l) => {
              const builtIn = l.id === buildId;
              const onShelf = entries.some((e) => e.id === l.id);
              return (
                <li key={l.id} className="flex items-start gap-3 py-3">
                  <span
                    aria-hidden
                    className="mt-1.5 h-3 w-3 flex-shrink-0 rounded-full border border-ink-200"
                    style={{ backgroundColor: l.themeColor ?? 'transparent' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-900">{l.title}</p>
                    {l.questionCount || l.categories?.length ? (
                      <p className="text-xs text-ink-500">
                        {l.questionCount ? `${l.questionCount} questions` : null}
                        {l.questionCount && l.categories?.length ? ' · ' : null}
                        {l.categories?.length
                          ? `${l.categories.length} categor${l.categories.length === 1 ? 'y' : 'ies'}`
                          : null}
                      </p>
                    ) : null}
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-600">{l.description}</p>
                  </div>
                  {builtIn || onShelf ? (
                    <span className="mt-1 flex-shrink-0 rounded-full border border-ink-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                      {builtIn ? 'Built in' : 'On the shelf'}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-0.5 flex-shrink-0"
                      data-testid={`registry-insert-${l.id}`}
                      disabled={busyRepo !== null}
                      onClick={() => void handleRegistryInsert(l)}
                    >
                      <Download className="h-4 w-4" />
                      {busyRepo === l.repo ? 'Inserting…' : 'Insert'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
          <PackagePlus className="h-5 w-5 text-ink-500" />
          Insert a pack
        </h2>
        <p className="mt-1 text-sm text-ink-600">
          From a pack&apos;s files (<code>pack.json</code> +{' '}
          <code>questions.json</code>), a single bundle <code>.json</code>, or a
          URL — a GitHub pack repo works directly.
        </p>

        <div className="mt-4 flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleUrl();
            }}
            placeholder="https://github.com/you/your-pack"
            aria-label="Pack URL"
            data-testid="insert-url"
            className="min-w-0 flex-1 rounded-xl border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleUrl()}
            disabled={busy || !url.trim()}
            data-testid="insert-url-go"
          >
            <LinkIcon className="h-4 w-4" />
            Fetch
          </Button>
        </div>

        <div className="mt-3">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            multiple
            className="hidden"
            data-testid="insert-files"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            <FileJson className="h-4 w-4" />
            Choose files…
          </Button>
        </div>

        {errors.length > 0 ? (
          <div
            data-testid="insert-errors"
            className="mt-4 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3 text-sm text-ink-800"
          >
            <p className="font-semibold">That pack didn&apos;t validate:</p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {errors.slice(0, MAX_ERRORS_SHOWN).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            {errors.length > MAX_ERRORS_SHOWN ? (
              <p className="mt-1 text-xs text-ink-500">
                …and {errors.length - MAX_ERRORS_SHOWN} more.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
