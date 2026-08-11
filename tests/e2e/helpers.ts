import { spawn } from 'node:child_process';
import puppeteer, { type Browser, type Page } from 'puppeteer';

export interface Server {
  url: string;
  stop: () => Promise<void>;
}

/**
 * Start a static file server on the given port serving the production build
 * in `out/`. Resolves when /index.html responds 200.
 *
 * Caller must have run `NEXT_PUBLIC_BASE_PATH="" npx next build` first so
 * the asset URLs are root-relative (http-server doesn't add a basePath).
 */
export async function startStaticServer(port: number): Promise<Server> {
  // detached → own process group, so stop() can signal the WHOLE group.
  // npx is a wrapper that spawns the real http-server as a child; killing
  // just the wrapper leaves an orphaned server squatting on the port (and
  // "offline" tests quietly testing nothing).
  const proc = spawn(
    'npx',
    ['--yes', 'http-server', 'out', '-p', String(port), '-s', '-c-1'],
    { stdio: 'pipe', detached: true },
  );
  proc.stderr?.on('data', (d) => process.stderr.write(`[http-server] ${d}`));

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(`${url}/`, 15_000);

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

  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        proc.once('exit', () => resolve());
        killGroup('SIGTERM');
        setTimeout(() => killGroup('SIGKILL'), 2_000);
      }),
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

export function baseUrl(): string {
  const u = process.env.E2E_BASE_URL;
  if (!u) {
    throw new Error(
      'E2E_BASE_URL not set. Run via vitest with the e2e config (which sets it via globalSetup).',
    );
  }
  return u;
}

export async function launchBrowser(): Promise<Browser> {
  // Set E2E_HEADED=1 to watch the tests drive a real Chrome window.
  // E2E_SLOWMO (ms) paces each action so it's followable (default 75 in
  // headed mode, 0 headless). 75ms stays under the 60s test timeout even
  // for the long "complete session" specs; bump it (E2E_SLOWMO=250) to
  // watch a single short spec more slowly. CI leaves both unset → fast.
  const headed = process.env.E2E_HEADED === '1';
  const slowMo = process.env.E2E_SLOWMO
    ? Number(process.env.E2E_SLOWMO)
    : headed
      ? 75
      : 0;
  return puppeteer.launch({
    headless: !headed,
    slowMo,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

export async function newPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 1 });
  return page;
}

/**
 * Clear all browser storage on the current origin (localStorage,
 * sessionStorage, IndexedDB, caches, service workers). Call between tests
 * for isolation.
 */
export async function resetOrigin(page: Page): Promise<void> {
  await page.evaluate(async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    if ('caches' in self) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  });
}

export interface SeedAttempt {
  questionId: string;
  /** Engine type is plain string — each variant uses its own
   *  discriminator (11+ subject keys, CCA domain keys, etc.). */
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
 *
 * `keyPrefix` defaults to the 11+ namespace; pass
 * the active pack's prefix (e.g. 'quizmill.solar-system-demo.') when seeding
 * CCA E2E suite.
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

/** Wait until any element on the page contains the given text. */
export async function waitForText(
  page: Page,
  text: string | RegExp,
  timeoutMs = 10_000,
): Promise<void> {
  if (typeof text === 'string') {
    await page.waitForFunction(
      (t) => document.body.textContent?.includes(t),
      { timeout: timeoutMs },
      text,
    );
  } else {
    // Pass the regex source + flags through evaluate (Page.evaluate can't
    // serialise a RegExp directly).
    await page.waitForFunction(
      ({ source, flags }) =>
        new RegExp(source, flags).test(document.body.textContent ?? ''),
      { timeout: timeoutMs },
      { source: text.source, flags: text.flags },
    );
  }
}

/** Click the first <button> whose visible text contains `text`. */
export async function clickButtonByText(
  page: Page,
  text: string,
  timeoutMs = 10_000,
): Promise<void> {
  await page.waitForFunction(
    (t) =>
      Array.from(document.querySelectorAll('button')).some((b) =>
        b.textContent?.includes(t),
      ),
    { timeout: timeoutMs },
    text,
  );
  const handle = await page.evaluateHandle((t) => {
    return (
      Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes(t),
      ) ?? null
    );
  }, text);
  const el = handle.asElement();
  if (!el) throw new Error(`no button containing "${text}"`);
  await (el as Awaited<ReturnType<Page['$']>>)!.click();
}

/** Trimmed text content of body — for assertions on the whole page. */
export async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.textContent?.trim() ?? '');
}

/** Read all the question-text candidate buttons (the answer options). */
export async function optionTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .map((b) => b.textContent?.trim() ?? '')
      .filter((t) => t.length > 0 && t.length < 100),
  );
}
