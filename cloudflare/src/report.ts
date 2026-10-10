/**
 * Read-only usage report over the sync worker's `rows` table — the pure
 * half of cloudflare/scripts/events-report.ts, kept free of Cloudflare
 * and Node types so it is unit-testable from the engine's vitest suite
 * (tests/events-report.test.ts), exactly like ops.ts.
 *
 * The worker never interprets rows; this is the one place that does, and
 * it runs on the operator's machine (`wrangler d1 execute`), never in the
 * worker. There is deliberately NO endpoint behind it: the raw rows are
 * one learner's practice history, keyed by the hash of their sync key,
 * and nothing here should ever be reachable without wrangler's own
 * Cloudflare login.
 *
 * What comes out is aggregate only — per pack: learners, 7d/30d activity,
 * sessions, attempts, mistakes rescued/open, events by type. A user id
 * (even hashed) never reaches the output; the test asserts it.
 */
import type { AppEvent, Attempt, Session } from '../../src/data/types';
import { unresolvedMistakeIds } from '../../src/lib/mistakes';

/** One row of the `rows` table as the report needs it. */
export interface RawRow {
  user_id: string;
  pack_id: string;
  tbl: string;
  data: string;
}

/**
 * Everything the report reads, in one statement — the operator runs it
 * through `wrangler d1 execute --json` and pipes the result in. Only the
 * three tables with a timestamp per row; achievements, votes and notes
 * say nothing about activity that attempts don't already say.
 */
export const REPORT_SQL = `SELECT user_id, pack_id, tbl, data FROM rows WHERE tbl IN ('sessions', 'attempts', 'events')`;

const DAY_MS = 86_400_000;

export interface EventTally {
  type: string;
  total: number;
  last30d: number;
  last7d: number;
}

export interface PackReport {
  packId: string;
  /** Distinct sync keys (hashed) with any row in this pack. */
  learners: number;
  /** Learners who answered at least one question in the window. */
  active7d: number;
  active30d: number;
  sessions: { total: number; last30d: number };
  attempts: { total: number; last30d: number; correct: number };
  /**
   * Mistakes by the engine's own rescue rule (src/lib/mistakes.ts): a
   * question answered wrong is "open" until the learner later gets it
   * right; `rescued` = wrong-at-some-point questions that are no longer
   * open. Summed over learners.
   */
  mistakes: { rescued: number; open: number };
  /** Busiest type first, then alphabetical. */
  events: EventTally[];
}

export interface Report {
  /** ISO time the windows end at. */
  generatedAt: string;
  packs: PackReport[];
}

/**
 * Accept either wrangler's `d1 execute --json` envelope
 * (`[{ results: [...], success, meta }]`) or a bare array of rows.
 */
export function parseRowsJson(text: string): RawRow[] {
  const parsed: unknown = JSON.parse(text);
  const rows: unknown[] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === 'object' && Array.isArray((item as { results?: unknown }).results)) {
        rows.push(...((item as { results: unknown[] }).results));
      } else {
        rows.push(item);
      }
    }
  } else {
    throw new Error('expected a JSON array of rows (or wrangler --json output)');
  }
  for (const r of rows) {
    const o = r as Partial<RawRow> | null;
    if (
      !o ||
      typeof o.user_id !== 'string' ||
      typeof o.pack_id !== 'string' ||
      typeof o.tbl !== 'string' ||
      typeof o.data !== 'string'
    ) {
      throw new Error('expected rows with user_id, pack_id, tbl and data columns');
    }
  }
  return rows as RawRow[];
}

function parseData<T>(row: RawRow): T | null {
  try {
    const v: unknown = JSON.parse(row.data);
    return v && typeof v === 'object' ? (v as T) : null;
  } catch {
    return null;
  }
}

interface PackAcc {
  users: Set<string>;
  sessions: Session[];
  attemptsByUser: Map<string, Attempt[]>;
  events: AppEvent[];
}

/** Build the per-pack aggregates. `now` is the end of the 7d/30d windows. */
export function buildReport(rows: readonly RawRow[], now: number): Report {
  const packs = new Map<string, PackAcc>();
  const acc = (packId: string): PackAcc => {
    let p = packs.get(packId);
    if (!p) {
      p = { users: new Set(), sessions: [], attemptsByUser: new Map(), events: [] };
      packs.set(packId, p);
    }
    return p;
  };

  for (const row of rows) {
    if (row.tbl === 'sessions') {
      const s = parseData<Session>(row);
      if (!s || typeof s.startedAt !== 'number') continue;
      const p = acc(row.pack_id);
      p.users.add(row.user_id);
      p.sessions.push(s);
    } else if (row.tbl === 'attempts') {
      const a = parseData<Attempt>(row);
      if (!a || typeof a.answeredAt !== 'number' || typeof a.questionId !== 'string') continue;
      const p = acc(row.pack_id);
      p.users.add(row.user_id);
      const list = p.attemptsByUser.get(row.user_id) ?? [];
      list.push(a);
      p.attemptsByUser.set(row.user_id, list);
    } else if (row.tbl === 'events') {
      const e = parseData<AppEvent>(row);
      if (!e || typeof e.at !== 'number' || typeof e.type !== 'string') continue;
      const p = acc(row.pack_id);
      p.users.add(row.user_id);
      p.events.push(e);
    }
  }

  const since7 = now - 7 * DAY_MS;
  const since30 = now - 30 * DAY_MS;

  const out: PackReport[] = [];
  for (const [packId, p] of packs) {
    const active7 = new Set<string>();
    const active30 = new Set<string>();
    let attemptsTotal = 0;
    let attempts30 = 0;
    let correct = 0;
    let rescued = 0;
    let open = 0;
    for (const [user, attempts] of p.attemptsByUser) {
      for (const a of attempts) {
        attemptsTotal++;
        if (a.isCorrect) correct++;
        if (a.answeredAt >= since30) {
          attempts30++;
          active30.add(user);
          if (a.answeredAt >= since7) active7.add(user);
        }
      }
      const everWrong = new Set(attempts.filter((a) => !a.isCorrect).map((a) => a.questionId));
      const stillOpen = unresolvedMistakeIds(attempts).length;
      open += stillOpen;
      rescued += everWrong.size - stillOpen;
    }

    const tallies = new Map<string, EventTally>();
    for (const e of p.events) {
      let t = tallies.get(e.type);
      if (!t) {
        t = { type: e.type, total: 0, last30d: 0, last7d: 0 };
        tallies.set(e.type, t);
      }
      t.total++;
      if (e.at >= since30) t.last30d++;
      if (e.at >= since7) t.last7d++;
    }

    out.push({
      packId,
      learners: p.users.size,
      active7d: active7.size,
      active30d: active30.size,
      sessions: {
        total: p.sessions.length,
        last30d: p.sessions.filter((s) => s.startedAt >= since30).length,
      },
      attempts: { total: attemptsTotal, last30d: attempts30, correct },
      mistakes: { rescued, open },
      events: [...tallies.values()].sort(
        (a, b) => b.total - a.total || a.type.localeCompare(b.type),
      ),
    });
  }

  out.sort((a, b) => b.learners - a.learners || a.packId.localeCompare(b.packId));
  return { generatedAt: new Date(now).toISOString(), packs: out };
}

// ── Markdown ────────────────────────────────────────────────────────────

/**
 * The shape of `GET /v1/analytics/summary` on the sync worker (the
 * anonymous funnel beacons — a separate table from the synced rows).
 * Mirrored loosely on purpose: the report only needs the totals, and an
 * event the worker adds later still renders.
 */
export interface AnalyticsSummary {
  pack: string;
  days: number;
  since: string;
  events: Record<string, { count: number; devices: number }>;
  daily?: unknown[];
}

const pct = (n: number, of: number): string => (of === 0 ? '–' : `${Math.round((100 * n) / of)}%`);

export function renderMarkdown(
  report: Report,
  opts: { source: string; analytics?: Map<string, string> },
): string {
  const lines: string[] = [];
  lines.push('# quizmill sync usage report', '');
  lines.push(`Generated ${report.generatedAt}. Source: ${opts.source}.`, '');

  if (report.packs.length === 0) {
    lines.push('No synced practice history yet.', '');
    return lines.join('\n');
  }

  lines.push('## Overview', '');
  lines.push(
    '| Pack | Learners | Active 7d | Active 30d | Sessions | Attempts | Mistakes rescued | Mistakes open |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const p of report.packs) {
    lines.push(
      `| \`${p.packId}\` | ${p.learners} | ${p.active7d} | ${p.active30d} | ${p.sessions.total} | ${p.attempts.total} | ${p.mistakes.rescued} | ${p.mistakes.open} |`,
    );
  }
  lines.push('');

  for (const p of report.packs) {
    lines.push(`## ${p.packId}`, '');
    lines.push(
      `- Learners: ${p.learners} (active last 7 days: ${p.active7d}, last 30 days: ${p.active30d})`,
      `- Sessions: ${p.sessions.total} (last 30 days: ${p.sessions.last30d})`,
      `- Attempts: ${p.attempts.total} (last 30 days: ${p.attempts.last30d}), ${pct(p.attempts.correct, p.attempts.total)} correct`,
      `- Mistakes: ${p.mistakes.rescued} rescued, ${p.mistakes.open} still open`,
      '',
    );
    lines.push('### Events by type', '');
    if (p.events.length === 0) {
      lines.push('No events mirrored for this pack.', '');
    } else {
      lines.push('| Event | All time | Last 30d | Last 7d |', '|---|---:|---:|---:|');
      for (const e of p.events) {
        lines.push(`| \`${e.type}\` | ${e.total} | ${e.last30d} | ${e.last7d} |`);
      }
      lines.push('');
    }
    const analytics = opts.analytics?.get(p.packId);
    if (analytics) lines.push(analytics, '');
  }

  lines.push('## Definitions', '');
  lines.push(
    '- A learner is one sync key (the server holds only its hash; nothing here names anyone).',
    '- Active = answered at least one question in the window, by the answer time the device recorded.',
    '- Mistakes follow the engine’s own rescue rule: a question answered wrong stays open until the learner later gets it right; rescued = once-wrong questions no longer open.',
    '- Counts are what is mirrored right now. A learner who resets a pack (Settings → clear) removes their rows from these numbers.',
    '',
  );
  return lines.join('\n');
}

/**
 * The funnel block for one pack, from the worker's analytics summary —
 * or a one-liner saying why there isn't one (route not deployed, token
 * missing, …) so a blank never reads as "zero".
 */
export function renderAnalyticsSection(summary: AnalyticsSummary | null, reason?: string): string {
  if (!summary) {
    return `### Funnel (anonymous beacons)\n\nSummary not available${reason ? ` (${reason})` : ''}.`;
  }
  const lines = [
    `### Funnel (anonymous beacons, last ${summary.days} days)`,
    '',
    '| Event | Beacons | Devices |',
    '|---|---:|---:|',
  ];
  for (const [event, v] of Object.entries(summary.events)) {
    lines.push(`| \`${event}\` | ${v.count} | ${v.devices} |`);
  }
  return lines.join('\n');
}
