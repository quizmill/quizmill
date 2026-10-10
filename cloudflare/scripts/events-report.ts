/**
 * Usage report over the sync worker's database — read-only, Markdown out.
 *
 *   npm run sync:report -- --remote                 # production D1 (wrangler login)
 *   npm run sync:report -- --local                  # the `wrangler dev` database
 *   npm run sync:report -- --from rows.json         # a saved query result (see --sql)
 *   npm run sync:report -- --remote --analytics https://sync.quizmill.dev
 *
 * Per pack: learners, active learners (7d/30d), sessions, attempts,
 * mistakes rescued/open, events by type. With `--analytics <worker url>`
 * each pack also gets the worker's anonymous funnel summary
 * (`GET /v1/analytics/summary`; set ANALYTICS_READ_TOKEN when the worker
 * requires one) — a route that only exists on workers deployed with it,
 * so the section says "not available" rather than printing zeros.
 *
 * This is an operator tool: it needs wrangler's own Cloudflare login (or
 * a file you exported with it) and runs on your machine. There is
 * deliberately no endpoint behind it — the rows are learners' practice
 * histories, and the output is aggregate only (no user ids, hashed or
 * otherwise). The aggregation itself is pure and unit-tested:
 * cloudflare/src/report.ts, tests/events-report.test.ts.
 *
 * Options:
 *   --remote | --local        where wrangler should run REPORT_SQL
 *   --from <file>             read rows from a JSON file instead (wrangler
 *                             `--json` output or a bare row array)
 *   --db <name>               D1 database name (default quizmill-sync)
 *   --analytics <url>         worker base URL for the funnel summary
 *   --days <n>                funnel window in days (default 30)
 *   --out <file>              write the Markdown there instead of stdout
 *   --sql                     print the query and exit
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  REPORT_SQL,
  buildReport,
  parseRowsJson,
  renderAnalyticsSection,
  renderMarkdown,
  type AnalyticsSummary,
} from '../src/report';

interface Options {
  source: 'remote' | 'local' | 'file' | null;
  file?: string;
  db: string;
  analytics?: string;
  days: number;
  out?: string;
  sql: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { source: null, db: 'quizmill-sync', days: 30, sql: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--remote':
      case '--local':
        opts.source = arg.slice(2) as 'remote' | 'local';
        break;
      case '--from':
        opts.source = 'file';
        opts.file = next();
        break;
      case '--db':
        opts.db = next();
        break;
      case '--analytics':
        opts.analytics = next().replace(/\/+$/, '');
        break;
      case '--days':
        opts.days = Math.max(1, Math.floor(Number(next())) || 30);
        break;
      case '--out':
        opts.out = next();
        break;
      case '--sql':
        opts.sql = true;
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }
  return opts;
}

/** Run the query through wrangler and return its stdout (JSON). */
function queryViaWrangler(db: string, where: 'remote' | 'local'): string {
  const cwd = path.join(__dirname, '..');
  const args = ['wrangler', 'd1', 'execute', db, `--${where}`, '--json', '--command', REPORT_SQL];
  const res = spawnSync('npx', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`wrangler exited ${res.status}:\n${res.stderr || res.stdout}`);
  }
  // wrangler keeps its banner off stdout under --json, but be forgiving:
  // the payload is the first JSON array on stdout.
  const start = res.stdout.indexOf('[');
  if (start < 0) throw new Error(`no JSON in wrangler output:\n${res.stdout}`);
  return res.stdout.slice(start);
}

async function fetchAnalytics(
  base: string,
  pack: string,
  days: number,
): Promise<{ summary: AnalyticsSummary | null; reason?: string }> {
  const token = process.env.ANALYTICS_READ_TOKEN;
  const url = `${base}/v1/analytics/summary?pack=${encodeURIComponent(pack)}&days=${days}`;
  try {
    const res = await fetch(url, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return { summary: null, reason: `HTTP ${res.status}` };
    const body = (await res.json()) as Partial<AnalyticsSummary>;
    if (!body || typeof body !== 'object' || !body.events || typeof body.events !== 'object') {
      return { summary: null, reason: 'unexpected response shape' };
    }
    return {
      summary: {
        pack,
        days: typeof body.days === 'number' ? body.days : days,
        since: typeof body.since === 'string' ? body.since : '',
        events: body.events,
      },
    };
  } catch (err) {
    return { summary: null, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.sql) {
    console.log(REPORT_SQL);
    return;
  }
  if (!opts.source) {
    throw new Error('say where the rows come from: --remote, --local, or --from <file>');
  }

  let json: string;
  let source: string;
  if (opts.source === 'file') {
    json = fs.readFileSync(opts.file!, 'utf8');
    source = `file ${opts.file}`;
  } else {
    json = queryViaWrangler(opts.db, opts.source);
    source = `${opts.source} D1 \`${opts.db}\``;
  }

  const report = buildReport(parseRowsJson(json), Date.now());

  let analytics: Map<string, string> | undefined;
  if (opts.analytics) {
    analytics = new Map();
    for (const p of report.packs) {
      const { summary, reason } = await fetchAnalytics(opts.analytics, p.packId, opts.days);
      analytics.set(p.packId, renderAnalyticsSection(summary, reason));
    }
  }

  const md = renderMarkdown(report, { source, analytics });
  if (opts.out) {
    fs.writeFileSync(opts.out, md);
    console.error(`wrote ${opts.out}`);
  } else {
    process.stdout.write(md);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
