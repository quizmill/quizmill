import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The home app at app.quizmill.dev is built from the same demo pack the
// old demo at try.quizmill.dev was, so there is exactly one engine-owned
// demo app and one Pages project for it (quizmill-app). try.quizmill.dev
// is a zone-level redirect to app.quizmill.dev, nothing more: no doc,
// workflow or comment should send anyone there, and no workflow should
// build or deploy to the retired quizmill-try project — a stray entry
// would quietly resurrect the second app this guard exists to prevent.

const ROOT = path.join(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Every file under `rel` (recursively) whose name matches `pattern`. */
function filesUnder(rel: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (pattern.test(entry.name)) out.push(path.relative(ROOT, full));
    }
  };
  walk(path.join(ROOT, rel));
  return out;
}

const RETIRED = /try\.quizmill\.dev|quizmill-try/;

describe('retired demo host', () => {
  const files = [
    'CLAUDE.md',
    'README.md',
    'cloudflare/README.md',
    ...filesUnder('.github/workflows', /\.ya?ml$/),
    ...filesUnder('docs', /\.md$/),
  ];

  it('is named nowhere in the docs or the workflows, except to say it redirects', () => {
    for (const file of files) {
      const stray = read(file)
        .split('\n')
        .filter((line) => RETIRED.test(line) && !/redirect/.test(line));
      expect(stray, `${file} still points at the retired demo host`).toEqual([]);
    }
  });

  it('deploy-apps builds the home app and the showcase pack, nothing else', () => {
    const matrix = read('.github/workflows/deploy-apps.yml').match(/include:\n([\s\S]*?)\n\s+steps:/)?.[1] ?? '';
    const names = [...matrix.matchAll(/^\s+- name: (\S+)$/gm)].map((m) => m[1]);
    expect(names).toEqual(['world-capitals', 'app']);
  });

  it('PR previews deploy to a non-production branch of the home app project', () => {
    const deploy = read('.github/workflows/pr-preview.yml').match(/pages deploy .*$/m)?.[0] ?? '';
    expect(deploy).toContain('--project-name quizmill-app');
    expect(deploy).toMatch(/--branch=pr-\$\{\{ github\.event\.pull_request\.number \}\}/);
  });
});
