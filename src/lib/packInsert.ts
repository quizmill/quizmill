/**
 * Turning user input — picked files or a pasted URL — into an ActivePack
 * candidate for `insertPack` to validate. Pure/injectable so the parsing
 * and URL wrangling are unit-testable without a browser.
 *
 * Two input shapes are accepted everywhere:
 *  - a pack DIRECTORY: the standard pack files (pack.json + questions.json,
 *    optional scenarios.json / concepts.json) picked together or fetched
 *    from a base URL;
 *  - a single BUNDLE .json: `{ manifest, questions, scenarios?, concepts? }`
 *    — the same shape the runtime handoff uses.
 */

export interface NamedText {
  name: string;
  text: string;
}

export type PackCandidate = {
  manifest?: unknown;
  questions?: unknown;
  scenarios?: unknown;
  concepts?: unknown;
};

export type ParseOutcome =
  | { ok: true; candidate: PackCandidate }
  | { ok: false; errors: string[] };

function parseJson(name: string, text: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: `${name}: not valid JSON` };
  }
}

function isBundle(value: unknown): value is PackCandidate {
  return (
    typeof value === 'object' &&
    value !== null &&
    'manifest' in value &&
    'questions' in value
  );
}

/** Assemble a pack candidate from picked files (already read to text). */
export function parsePackFiles(files: NamedText[]): ParseOutcome {
  if (files.length === 0) return { ok: false, errors: ['no files selected'] };

  // A single file may be a self-contained bundle.
  if (files.length === 1) {
    const { value, error } = parseJson(files[0].name, files[0].text);
    if (error) return { ok: false, errors: [error] };
    if (isBundle(value)) return { ok: true, candidate: value };
    // Fall through: a lone pack.json etc. is handled (and refused) below.
  }

  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f] as const));
  const errors: string[] = [];
  const pick = (name: string): unknown => {
    const f = byName.get(name);
    if (!f) return undefined;
    const { value, error } = parseJson(f.name, f.text);
    if (error) errors.push(error);
    return value;
  };

  const manifest = pick('pack.json');
  const questions = pick('questions.json');
  const scenarios = pick('scenarios.json');
  const concepts = pick('concepts.json');

  if (!byName.has('pack.json') || !byName.has('questions.json')) {
    return {
      ok: false,
      errors: [
        'select the pack’s files together (pack.json + questions.json, optionally scenarios.json / concepts.json), or one bundle .json with "manifest" and "questions"',
      ],
    };
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, candidate: { manifest, questions, scenarios, concepts } };
}

export type ResolvedPackUrl =
  | { kind: 'bundle'; url: string }
  | { kind: 'dir'; base: string };

/**
 * Make sense of a pasted URL. GitHub repo/tree URLs are rewritten to
 * raw.githubusercontent.com (the HTML pages don't serve JSON or CORS);
 * a URL ending in .json is treated as a bundle; anything else as a pack
 * directory base.
 */
export function resolvePackUrl(input: string): ResolvedPackUrl | null {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const gh = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(\/.*)?)?$/i,
  );
  if (gh) {
    const [, owner, repo, ref, path] = gh;
    return {
      kind: 'dir',
      base: `https://raw.githubusercontent.com/${owner}/${repo}/${ref ?? 'HEAD'}${path ?? ''}`,
    };
  }
  if (/\.json$/i.test(trimmed)) return { kind: 'bundle', url: trimmed };
  return { kind: 'dir', base: trimmed };
}

/** Fetch a pack candidate from a resolved URL. `fetchImpl` is injectable
 *  for tests. Optional files that 404 are simply omitted. */
export async function fetchPackFromUrl(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParseOutcome> {
  const resolved = resolvePackUrl(input);
  if (!resolved) {
    return { ok: false, errors: ['enter a full http(s) URL — a pack directory, GitHub repo, or bundle .json'] };
  }

  const load = async (url: string, required: boolean): Promise<{ value?: unknown; error?: string }> => {
    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch {
      return required ? { error: `${url}: could not fetch` } : {};
    }
    if (!res.ok) {
      return required ? { error: `${url}: HTTP ${res.status}` } : {};
    }
    try {
      return { value: await res.json() };
    } catch {
      return { error: `${url}: not valid JSON` };
    }
  };

  if (resolved.kind === 'bundle') {
    const { value, error } = await load(resolved.url, true);
    if (error) return { ok: false, errors: [error] };
    if (!isBundle(value)) {
      return { ok: false, errors: ['the file is not a pack bundle (expected "manifest" and "questions")'] };
    }
    return { ok: true, candidate: value };
  }

  const [manifest, questions, scenarios, concepts] = await Promise.all([
    load(`${resolved.base}/pack.json`, true),
    load(`${resolved.base}/questions.json`, true),
    load(`${resolved.base}/scenarios.json`, false),
    load(`${resolved.base}/concepts.json`, false),
  ]);
  const errors = [manifest.error, questions.error, scenarios.error, concepts.error].filter(
    (e): e is string => Boolean(e),
  );
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    candidate: {
      manifest: manifest.value,
      questions: questions.value,
      scenarios: scenarios.value,
      concepts: concepts.value,
    },
  };
}
