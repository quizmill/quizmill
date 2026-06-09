/**
 * Fetch a learning pack from a GitHub repo so `pack:use` can install
 * packs that live outside this checkout:
 *
 *   npm run pack:use quizmill/pack-claude-cert
 *   npm run pack:use quizmill/pack-claude-cert#main
 *   npm run pack:use https://github.com/quizmill/pack-claude-cert
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
}

const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Parse a remote pack source. Returns null when the string can't be a
 * GitHub reference (the caller treats those as local paths). Accepted:
 * `owner/repo`, `github:owner/repo`, `https://github.com/owner/repo`
 * (optionally `.git` or `/tree/<ref>`), `git@github.com:owner/repo.git`
 * — all with an optional `#ref` suffix.
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

  spec = spec.replace(/\.git$/, '').replace(/\/+$/, '');

  const segments = spec.split('/');
  // `owner/repo` or a github.com URL path like `owner/repo/tree/<ref>`.
  if (segments.length !== 2) {
    if (segments.length >= 4 && segments[2] === 'tree') {
      ref = ref ?? segments.slice(3).join('/');
      segments.length = 2;
    } else {
      return null;
    }
  }

  const [owner, repo] = segments;
  if (!NAME.test(owner) || !NAME.test(repo)) return null;
  return { owner, repo, ref };
}

/** Human-readable form for logs and errors. */
export function formatPackSpec(spec: RemotePackSpec): string {
  return `${spec.owner}/${spec.repo}${spec.ref ? `#${spec.ref}` : ''}`;
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

/** Locate the directory containing pack.json within the download. */
function findPackDir(root: string, depth = 0): string | null {
  if (fs.existsSync(path.join(root, 'pack.json'))) return root;
  if (depth >= 2) return null;
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  for (const name of entries) {
    const found = findPackDir(path.join(root, name), depth + 1);
    if (found) return found;
  }
  return null;
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

  const dir = findPackDir(tmp);
  if (!dir) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(
      `${label} downloaded, but no pack.json found in it — is it a learning-pack repo?`,
    );
  }
  return dir;
}
