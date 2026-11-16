/**
 * Fetch a learning pack from a GitHub repo so `pack:use` can install
 * packs that live outside this checkout:
 *
 *   npm run pack:use quizmill/pack-claude-cert
 *   npm run pack:use quizmill/pack-claude-cert#main
 *   npm run pack:use https://github.com/quizmill/pack-claude-cert
 *   npm run pack:use quizmill/packs-aws/aws-clf     # one pack of several
 *
 * Public repos are fetched anonymously as a codeload tarball; when that
 * fails (private repo, no network to codeload) we fall back to
 * `git clone` over HTTPS and then SSH, so any repo the user can clone
 * is installable. The download lands in a temp directory — the
 * persistent snapshot is `content/pack/`, written by use-pack after
 * validation, so re-running the command refreshes the pack without
 * ever touching the `packs/` authoring workspace.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RemotePackSpec {
  owner: string;
  repo: string;
  /** Branch or tag. Defaults to the repo's default branch. */
  ref?: string;
  /** Directory inside the repo that holds the pack, for a repo that
   *  holds several. Defaults to wherever the one pack.json is. */
  path?: string;
}

const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Parse a remote pack source. Returns null when the string can't be a
 * GitHub reference (the caller treats those as local paths). Accepted:
 * `owner/repo`, `github:owner/repo`, `https://github.com/owner/repo`
 * (optionally `.git` or `/tree/<ref>`), `git@github.com:owner/repo.git`
 * — all with an optional `#ref` suffix, and the first three with an
 * optional `/<dir>` naming the pack's directory inside the repo.
 */
export function parsePackSpec(raw: string): RemotePackSpec | null {
  let spec = raw.trim();
  if (spec === '' || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~')) {
    return null;
  }

  let ref: string | undefined;
  const hash = spec.indexOf('#');
  if (hash !== -1) {
    ref = spec.slice(hash + 1) || undefined;
    spec = spec.slice(0, hash);
  }

  if (spec.startsWith('github:')) spec = spec.slice('github:'.length);

  const ssh = spec.match(/^git@github\.com:(.+)$/);
  if (ssh) spec = ssh[1];

  const url = spec.match(/^https?:\/\/(?:www\.)?github\.com\/(.+)$/);
  if (url) spec = url[1];

  const segments = spec.replace(/\/+$/, '').split('/');
  if (segments.length < 2) return null;
  const [owner, dotGitRepo, ...rest] = segments;
  // `.git` belongs to the repo segment only: a directory may end in it.
  const repo = dotGitRepo.replace(/\.git$/, '');
  if (!NAME.test(owner) || !NAME.test(repo)) return null;

  // What follows `owner/repo` is a directory inside the repo, or a
  // github.com URL path: `tree/HEAD[/<dir>]` (the form the registry links
  // to) or `tree/<ref>`. A ref may itself contain slashes, so only HEAD
  // can be told apart from a directory; any other ref takes `<dir>#<ref>`.
  let dir = rest;
  if (rest[0] === 'tree' && rest.length >= 2) {
    if (rest[1] === 'HEAD') {
      dir = rest.slice(2);
    } else {
      ref = ref ?? rest.slice(1).join('/');
      dir = [];
    }
  }
  if (dir.length === 0) return { owner, repo, ref };
  if (dir.some((s) => !NAME.test(s) || s === '.' || s === '..')) return null;
  return { owner, repo, ref, path: dir.join('/') };
}

/**
 * Human-readable form for logs, errors and install lines — itself a valid
 * spec that parses back to the same thing. A directory under `tree/` would
 * read back as a ref in the short form, so it takes the `/tree/HEAD/` URL.
 */
export function formatPackSpec(spec: RemotePackSpec): string {
  const ref = spec.ref ? `#${spec.ref}` : '';
  if (spec.path?.startsWith('tree/')) {
    return `https://github.com/${spec.owner}/${spec.repo}/tree/HEAD/${spec.path}${ref}`;
  }
  const dir = spec.path ? `/${spec.path}` : '';
  return `${spec.owner}/${spec.repo}${dir}${ref}`;
}

function tryTarball(spec: RemotePackSpec, tmp: string): boolean {
  const ref = spec.ref ?? 'HEAD';
  const url = `https://codeload.github.com/${spec.owner}/${spec.repo}/tar.gz/${ref}`;
  try {
    const tarPath = path.join(tmp, 'pack.tar.gz');
    execFileSync('curl', ['-fsSL', '--max-time', '60', '-o', tarPath, url], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    execFileSync('tar', ['-xzf', tarPath, '-C', tmp]);
    fs.rmSync(tarPath);
    return true;
  } catch {
    return false;
  }
}

function tryClone(spec: RemotePackSpec, tmp: string): boolean {
  const remotes = [
    `https://github.com/${spec.owner}/${spec.repo}.git`,
    `git@github.com:${spec.owner}/${spec.repo}.git`,
  ];
  for (const remote of remotes) {
    const dest = path.join(tmp, 'clone');
    const args = ['clone', '--depth', '1'];
    if (spec.ref) args.push('--branch', spec.ref);
    try {
      execFileSync('git', [...args, remote, dest], {
        stdio: ['ignore', 'ignore', 'ignore'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      fs.rmSync(path.join(dest, '.git'), { recursive: true, force: true });
      return true;
    } catch {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }
  return false;
}

function subdirs(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

const hasPack = (dir: string): boolean => fs.existsSync(path.join(dir, 'pack.json'));

/**
 * Locate the pack within a download (`tmp` holds the one directory the
 * tarball or clone unpacked to). With a `path` in the spec that directory
 * is the pack, or it's an error. Without one the pack is the repo root,
 * else the only top-level directory holding a pack.json; a repo holding
 * several is an error that lists them, never a silent pick of the first.
 */
export function locatePackDir(tmp: string, spec: RemotePackSpec): string {
  const label = formatPackSpec(spec);
  const tops = subdirs(tmp);
  const root = tops.length === 1 ? path.join(tmp, tops[0]) : tmp;
  const packs = subdirs(root).filter((name) => hasPack(path.join(root, name)));
  const choices = (): string =>
    packs.map((name) => `\n    ${formatPackSpec({ ...spec, path: name })}`).join('');

  if (spec.path) {
    const dir = path.join(root, spec.path);
    if (hasPack(dir)) return dir;
    throw new Error(
      `${label} downloaded, but there is no pack.json in ${spec.path}` +
        (packs.length > 0 ? ` — packs in this repo:${choices()}` : ''),
    );
  }
  if (hasPack(root)) return root;
  if (packs.length === 1) return path.join(root, packs[0]);
  if (packs.length > 1) {
    throw new Error(`${label} holds several packs — name one:${choices()}`);
  }
  throw new Error(
    `${label} downloaded, but no pack.json found in it — is it a learning-pack repo?`,
  );
}

/**
 * Download the pack and return the local directory holding pack.json.
 * Throws with an actionable message when the repo can't be reached or
 * doesn't contain a pack.
 */
export function fetchRemotePack(spec: RemotePackSpec): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quizmill-pack-'));
  const label = formatPackSpec(spec);

  console.log(`… fetching ${label} from GitHub`);
  if (!tryTarball(spec, tmp) && !tryClone(spec, tmp)) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(
      `could not fetch ${label} — tried the public tarball and git clone ` +
        `(HTTPS, then SSH). For private repos, make sure \`git clone\` works ` +
        `for your account; refs must be a branch or tag name.`,
    );
  }

  try {
    return locatePackDir(tmp, spec);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}
