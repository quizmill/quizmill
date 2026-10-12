import { spawn } from 'node:child_process';
import net from 'node:net';
import { expect, type Page } from '@playwright/test';

export interface Server {
  url: string;
  stop: () => Promise<void>;
}

/** A port the OS just reported free, so parallel workers never collide. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Start a static file server on a free port serving the production build
 * in `out/`. Resolves when / responds 200. Only for specs that must STOP
 * the server mid-test (the offline suites) — the rest share the
 * `webServer` from playwright.config.ts.
 */
export async function startStaticServer(
  opts: { dir?: string; cors?: boolean } = {},
): Promise<Server> {
  const port = await freePort();
  // detached → own process group, so stop() can signal the WHOLE group.
  // npx is a wrapper that spawns the real http-server as a child; killing
  // just the wrapper leaves an orphaned server squatting on the port (and
  // "offline" tests quietly testing nothing).
  const proc = spawn(
    'npx',
    [
      'http-server',
      opts.dir ?? 'out',
      '-p',
      String(port),
      '-s',
      '-c-1',
      ...(opts.cors ? ['--cors'] : []),
    ],
    { stdio: 'pipe', detached: true },
  );
  proc.stderr?.on('data', (d) => process.stderr.write(`[http-server] ${d}`));
  // Exiting before it answers (e.g. the port got taken) must fail loudly,
  // not let another server on that port pass for this one.
  const exited = new Promise<never>((_, reject) =>
    proc.once('exit', (code) => reject(new Error(`http-server exited early (${code})`))),
  );
  exited.catch(() => undefined);

  const url = `http://127.0.0.1:${port}`;
  await Promise.race([waitForServer(`${url}/`, 15_000), exited]);

  const killGroup = (signal: NodeJS.Signals) => {
    try {
      if (proc.pid) process.kill(-proc.pid, signal); // negative pid = group
      else proc.kill(signal);
    } catch {
      // group already gone — fall back to the wrapper just in case
      try {
        proc.kill(signal);
      } catch {
        /* already dead */
      }
    }
  };

  let stopped: Promise<void> | undefined;
  return {
    url,
    stop: () =>
      (stopped ??= new Promise<void>((resolve) => {
        if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
        proc.once('exit', () => resolve());
        killGroup('SIGTERM');
        setTimeout(() => killGroup('SIGKILL'), 2_000);
      })),
  };
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server at ${url} never returned 200 within ${timeoutMs}ms`);
}

/**
 * Stop the servers and prove they're gone: if an origin still answers
 * (e.g. a stale server squatting on the port), "offline" would silently
 * test nothing. Real servers are stopped rather than emulating offline
 * because offline emulation doesn't reliably cover service-worker fetches.
 */
export async function severNetwork(...servers: Server[]): Promise<void> {
  await Promise.all(servers.map((s) => s.stop()));
  const deadline = Date.now() + 5_000;
  for (const { url } of servers) {
    while (await fetch(`${url}/`).then(() => true, () => false)) {
      if (Date.now() > deadline) {
        throw new Error(`${url} still serving after stop() — stale http-server?`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * Wait until the service worker controls the page AND has precached the
 * practice route — it must be reachable offline without visiting it online.
 */
export async function waitForPrecache(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      if (!navigator.serviceWorker?.controller) return false;
      return Boolean(await caches.match('/practice/', { ignoreSearch: true }));
    },
    undefined,
    { timeout: 30_000, polling: 500 },
  );
}

export interface SeedAttempt {
  questionId: string;
  /** Engine type is plain string — each pack uses its own category keys. */
  subject: string;
  topic: string;
  isCorrect: boolean;
  /** Offset from "now" in ms (positive = past). e.g. 1000 = 1s ago. */
  agoMs: number;
}

/**
 * Seed localStorage on the current origin with one session and the given
 * attempts. The page must already be on the right origin before you call
 * this (so localStorage writes hit the right storage).
 */
export async function seedAttempts(
  page: Page,
  attempts: SeedAttempt[],
  keyPrefix: string = 'quizmill.solar-system-demo.',
): Promise<void> {
  await page.evaluate(
    ({ data, prefix }) => {
      const now = Date.now();
      const sessionId = 'seed-session-' + now;
      const subjectForSession = data[0]?.subject ?? 'seed';
      localStorage.setItem(
        `${prefix}sessions.v1`,
        JSON.stringify([
          {
            id: sessionId,
            subject: subjectForSession,
            startedAt: now - 24 * 3600_000,
            endedAt: now - 24 * 3600_000 + 60_000,
            questionCount: data.length,
            correctCount: data.filter((a) => a.isCorrect).length,
            mode: 'practice',
          },
        ]),
      );
      localStorage.setItem(
        `${prefix}attempts.v1`,
        JSON.stringify(
          data.map((a, i) => ({
            id: `seed-attempt-${i}`,
            sessionId,
            questionId: a.questionId,
            answeredAt: now - a.agoMs,
            selectedAnswer: 'seed',
            isCorrect: a.isCorrect,
            timeTakenSeconds: 5,
            subject: a.subject,
            topic: a.topic,
            difficulty: 2,
          })),
        ),
      );
    },
    { data: attempts, prefix: keyPrefix },
  );
}

/**
 * Wait until the body's textContent contains `text` (hidden text included,
 * as the specs always assumed).
 */
export async function waitForText(
  page: Page,
  text: string | RegExp,
  timeout = 10_000,
): Promise<void> {
  await expect(page.locator('body')).toContainText(text, { timeout });
}

/** Click the first <button> whose text contains `text`. */
export async function clickButtonByText(page: Page, text: string): Promise<void> {
  await page.locator('button', { hasText: text }).first().click();
}

/** Pick option A in a question runner. */
export async function pickOptionA(page: Page): Promise<void> {
  await page.locator('button', { hasText: /^\s*A/ }).first().click();
}

/** Trimmed text content of body — for assertions on the whole page. */
export async function bodyText(page: Page): Promise<string> {
  return (await page.locator('body').textContent())?.trim() ?? '';
}

/** A JSON value from localStorage on the current origin (null if unset). */
export async function readStorage<T = unknown>(page: Page, key: string): Promise<T | null> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
}
