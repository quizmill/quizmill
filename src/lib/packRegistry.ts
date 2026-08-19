/**
 * The pack registry, from inside the app — the discovery half of the pack
 * library. Mirrors the website's `lib/registry` (quizmill/website), which
 * serves the ENRICHED listing CORS-open at quizmill.dev/api/registry,
 * edge-cached, from the same source of truth: this repo's
 * tools/pack/registry.json (community packs are PR'd there).
 *
 * Three sources, best first, so browsing degrades instead of breaking:
 *   1. the website API — enriched with each pack's own manifest
 *      (theme colour, categories, question count);
 *   2. the raw registry JSON on GitHub — registry fields only;
 *   3. the registry BAKED into this build — works fully offline
 *      (inserting still needs the network to fetch the pack itself).
 *
 * Fetch-injected and framework-free, like the website module it mirrors.
 */
import bakedRegistry from '../../tools/pack/registry.json';

export interface RegistryEntry {
  id: string;
  title: string;
  description: string;
  repo: string; // "owner/name"
}

/** Registry entry, possibly enriched by the website API from the pack's
 *  own pack.json. All enrichment fields are best-effort. */
export interface PackListing extends RegistryEntry {
  themeColor?: string;
  homeSubtitle?: string;
  categories?: { key: string; label: string }[];
  questionCount?: number;
  schemaVersion?: number;
}

export type RegistrySource = 'api' | 'raw' | 'builtin';

export interface RegistryResult {
  listings: PackListing[];
  source: RegistrySource;
}

export const REGISTRY_API_URL = 'https://quizmill.dev/api/registry';
export const REGISTRY_RAW_URL =
  'https://raw.githubusercontent.com/quizmill/quizmill/main/tools/pack/registry.json';

/** The GitHub repo URL an entry installs from — feed it to
 *  `fetchPackFromUrl`, which rewrites it to raw HEAD (any default branch). */
export function registryRepoUrl(entry: RegistryEntry): string {
  return `https://github.com/${entry.repo}`;
}

function isEntry(p: unknown): p is PackListing {
  const e = p as RegistryEntry;
  return (
    !!p &&
    typeof e.id === 'string' &&
    typeof e.title === 'string' &&
    typeof e.repo === 'string' &&
    /^[\w.-]+\/[\w.-]+$/.test(e.repo)
  );
}

function sanitize(packs: unknown): PackListing[] {
  if (!Array.isArray(packs)) return [];
  return packs.filter(isEntry).map((e) => ({ ...e, description: e.description ?? '' }));
}

/** The registry compiled into this build — the always-available floor. */
export function builtinRegistry(): PackListing[] {
  return sanitize((bakedRegistry as { packs?: unknown }).packs);
}

async function tryFetch(
  url: string,
  fetchImpl: typeof fetch,
): Promise<PackListing[] | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { packs?: unknown };
    const listings = sanitize(body.packs);
    return listings.length > 0 ? listings : null;
  } catch {
    return null;
  }
}

/**
 * Load the freshest registry listing reachable right now. Never throws —
 * the baked registry is the floor, so the browse UI always has something
 * to show.
 */
export async function loadRegistry(
  fetchImpl: typeof fetch = fetch,
): Promise<RegistryResult> {
  const api = await tryFetch(REGISTRY_API_URL, fetchImpl);
  if (api) return { listings: api, source: 'api' };
  const raw = await tryFetch(REGISTRY_RAW_URL, fetchImpl);
  if (raw) return { listings: raw, source: 'raw' };
  return { listings: builtinRegistry(), source: 'builtin' };
}
