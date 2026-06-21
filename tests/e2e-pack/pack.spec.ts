import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type { Browser, Page } from 'puppeteer';
import {
  baseUrl,
  bodyText,
  clickButtonByText,
  launchBrowser,
  newPage,
  resetOrigin,
  seedAttempts,
  waitForText,
} from '../e2e/helpers';

/**
 * End-to-end coverage for the generic pack variant, running against
 * the committed DEMO pack (content/pack-demo — solar system). Assumes
 * the pack-variant static build is in `out/` (the prebuild ensure-pack
 * hook seeds the demo when no other pack is active). If a different
 * pack was activated locally via pack:use, these specs will fail —
 * re-seed with: rm -rf content/pack && npx tsx scripts/ensure-pack.ts
 */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  page = await newPage(browser);
  page.on('pageerror', (e) =>
    console.error('[pageerror]', e instanceof Error ? e.message : e),
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console]', msg.text());
  });
  await page.goto(baseUrl() + '/');
  await resetOrigin(page);
  await page.goto(baseUrl() + '/');
});

afterEach(async () => {
  await page.close();
});

describe('pack home page', () => {
  it('renders the manifest title, subtitle, and category cards', async () => {
    await waitForText(page, 'Solar System Practice');
    const body = await bodyText(page);
    expect(body).toContain('Solar System Practice');
    expect(body).toContain('Pick a category');
    expect(body).toContain('Planets & Moons');
    expect(body).toContain('Space Exploration');
    // Manifest weights surface as chips (0.6 / 0.4).
    expect(body).toContain('60%');
    expect(body).toContain('40%');
  });

  it('shows the available question count per category', async () => {
    await waitForText(page, 'questions available');
    const body = await bodyText(page);
    expect(/\d+ questions available/.test(body)).toBe(true);
  });

  it('credits the engine with a link back to quizmill.dev', async () => {
    await waitForText(page, /Built with\s+quizmill/);
    const href = await page.$eval('footer a', (el) => el.getAttribute('href'));
    expect(href).toBe('https://quizmill.dev');
  });
});

describe('pack practice flow', () => {
  it('runs a complete session and lands on the results screen', async () => {
    await page.goto(baseUrl() + '/practice/planets/');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

    const total = await page.evaluate(() => {
      const m = (document.body.textContent ?? '').match(/Q\s*1\s*\/\s*(\d+)/);
      return m ? Number(m[1]) : 0;
    });
    expect(total).toBeGreaterThan(0);

    for (let i = 0; i < total; i++) {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const aBtn = buttons.find((b) =>
          /^A/.test(b.textContent?.trim() ?? ''),
        );
        if (aBtn) (aBtn as HTMLButtonElement).click();
      });
      await clickButtonByText(page, 'Check answer');
      await waitForText(page, /Correct\.|Not quite\./);
      const isLast = i === total - 1;
      await clickButtonByText(page, isLast ? 'See results' : 'Next question');
    }

    // Finishing the first session unlocks the 'First steps' sticker —
    // the celebration toast renders with the results screen (and
    // auto-dismisses ~2s later, hence the immediate wait).
    await page.waitForSelector('[data-testid="celebration"]', {
      timeout: 5_000,
    });

    await waitForText(page, 'Practice complete');
    const resultBody = await bodyText(page);
    expect(resultBody).toMatch(new RegExp(`\\d+\\/${total}`));
    expect(resultBody).toMatch(/\d+% correct/);

    // ...and the cabinet now shows it as earned.
    await page.goto(baseUrl() + '/stickers/');
    await waitForText(page, 'Sticker cabinet');
    const earned = await page.$eval(
      '[data-testid="sticker-first-session"]',
      (el) => el.getAttribute('data-earned'),
    );
    expect(earned).toBe('true');
  }, 60_000);

  it('answered count persists to the home page and the vote row shows in feedback', async () => {
    await page.goto(baseUrl() + '/practice/planets/');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

    // Answer one question and check the feedback panel carries the
    // vote row (question feedback works for pack content too).
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const aBtn = buttons.find((b) => /^A/.test(b.textContent?.trim() ?? ''));
      if (aBtn) (aBtn as HTMLButtonElement).click();
    });
    await clickButtonByText(page, 'Check answer');
    await waitForText(page, /Correct\.|Not quite\./);
    await page.waitForSelector('[data-testid="vote-row"]');

    // Attempts persist under the pack variant's own namespace.
    const attemptsRaw = await page.evaluate(() =>
      localStorage.getItem('quizmill.solar-system-demo.attempts.v1'),
    );
    expect(attemptsRaw).toBeTruthy();
    const attempts = JSON.parse(attemptsRaw as string) as { subject: string }[];
    expect(attempts).toHaveLength(1);
    expect(attempts[0].subject).toBe('planets');
  }, 60_000);
});

describe('scratchpad', () => {
  it('keeps working notes across questions and clears on demand', async () => {
    await page.goto(baseUrl() + '/practice/planets/');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

    // Collapsed by default — the textarea isn't mounted until opened.
    expect(await page.$('[data-testid="scratchpad-text"]')).toBeNull();

    await page.click('[data-testid="scratchpad-toggle"]');
    await page.waitForSelector('[data-testid="scratchpad-text"]');
    await page.type('[data-testid="scratchpad-text"]', '7 x 8 = 56');

    // Persisted under the pack's own namespace (text + open state).
    const stored = await page.evaluate(() =>
      localStorage.getItem('quizmill.solar-system-demo.scratchpad.v1'),
    );
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored as string)).toMatchObject({
      text: '7 x 8 = 56',
      open: true,
    });

    // Answer and advance — the note and open state survive the question change.
    await page.evaluate(() => {
      const aBtn = Array.from(document.querySelectorAll('button')).find((b) =>
        /^A/.test(b.textContent?.trim() ?? ''),
      );
      if (aBtn) (aBtn as HTMLButtonElement).click();
    });
    await clickButtonByText(page, 'Check answer');
    await waitForText(page, /Correct\.|Not quite\./);
    await clickButtonByText(page, 'Next question');
    await waitForText(page, /Q\s*2\s*\/\s*\d+/);

    const carried = await page.$eval(
      '[data-testid="scratchpad-text"]',
      (el) => (el as HTMLTextAreaElement).value,
    );
    expect(carried).toBe('7 x 8 = 56');

    // Clear empties both the field and the stored note.
    await page.click('[data-testid="scratchpad-clear"]');
    const afterClear = await page.$eval(
      '[data-testid="scratchpad-text"]',
      (el) => (el as HTMLTextAreaElement).value,
    );
    expect(afterClear).toBe('');
    const cleared = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem('quizmill.solar-system-demo.scratchpad.v1') ?? '{}',
      ),
    );
    expect(cleared.text).toBe('');
  }, 60_000);

  it('draws strokes on the canvas, persists them, and undo/clear work', async () => {
    await page.goto(baseUrl() + '/practice/planets/');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

    await page.click('[data-testid="scratchpad-toggle"]');
    await page.click('[data-testid="scratchpad-tab-draw"]');
    await page.waitForSelector('[data-testid="scratchpad-canvas"]');

    const box = await page.$eval('[data-testid="scratchpad-canvas"]', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });

    // Drag a short stroke across the canvas with the mouse (which fires
    // pointer events in Chrome).
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    await page.mouse.move(cx - 40, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 20);
    await page.mouse.move(cx + 40, cy + 10);
    await page.mouse.up();

    const key = 'quizmill.solar-system-demo.scratchpad.v1';
    const afterDraw = await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k) ?? '{}'),
      key,
    );
    expect(afterDraw.mode).toBe('draw');
    expect(afterDraw.strokes.length).toBe(1);
    expect(afterDraw.strokes[0].points.length).toBeGreaterThan(1);
    // Points are normalised to 0..1.
    for (const p of afterDraw.strokes[0].points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }

    // Picking a pen colour persists too (tool state, like the notes).
    const swatch = (await page.$$('[data-testid="scratchpad-palette"] button'))[1];
    await swatch.click();
    const picked = await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k) ?? '{}').color,
      key,
    );
    expect(picked).toBe('#3b78e0');

    // A second stroke, then undo drops back to one.
    await page.mouse.move(cx - 30, cy + 30);
    await page.mouse.down();
    await page.mouse.move(cx + 30, cy + 30);
    await page.mouse.up();
    expect(
      (await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), key))
        .strokes.length,
    ).toBe(2);

    await page.click('[data-testid="scratchpad-undo"]');
    expect(
      (await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), key))
        .strokes.length,
    ).toBe(1);

    await page.click('[data-testid="scratchpad-clear-draw"]');
    expect(
      (await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), key))
        .strokes.length,
    ).toBe(0);
  }, 60_000);

  it('opens a pad saved by an older build (text only, no strokes/mode)', async () => {
    // Seed the pre-draw storage shape before loading the runner.
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem(
        'quizmill.solar-system-demo.scratchpad.v1',
        JSON.stringify({ text: 'legacy note', open: true }),
      );
    });
    await page.goto(baseUrl() + '/practice/planets/');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

    // Opens straight onto the Write tab with the old note intact, no crash.
    await page.waitForSelector('[data-testid="scratchpad-text"]');
    const value = await page.$eval(
      '[data-testid="scratchpad-text"]',
      (el) => (el as HTMLTextAreaElement).value,
    );
    expect(value).toBe('legacy note');

    // Draw tab is available and starts empty.
    await page.click('[data-testid="scratchpad-tab-draw"]');
    await page.waitForSelector('[data-testid="scratchpad-canvas"]');
    const undoDisabled = await page.$eval(
      '[data-testid="scratchpad-undo"]',
      (el) => (el as HTMLButtonElement).disabled,
    );
    expect(undoDisabled).toBe(true);
  }, 60_000);

  it('expands to full screen for more space, and collapses back', async () => {
    await page.goto(baseUrl() + '/practice/planets/');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

    await page.click('[data-testid="scratchpad-toggle"]');
    await page.waitForSelector('[data-testid="scratchpad-expand"]');

    // Enter full screen — the overlay appears and the inline expand button goes.
    await page.click('[data-testid="scratchpad-expand"]');
    await page.waitForSelector('[data-testid="scratchpad-fullscreen"]');
    expect(await page.$('[data-testid="scratchpad-expand"]')).toBeNull();

    // Typing in the full-screen pad writes to the same per-pack entry.
    await page.type('[data-testid="scratchpad-text"]', 'big space');
    const stored = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem('quizmill.solar-system-demo.scratchpad.v1') ?? '{}',
      ),
    );
    expect(stored.text).toBe('big space');

    // The full-screen canvas is far taller than the inline 192px box.
    await page.click('[data-testid="scratchpad-tab-draw"]');
    const fsHeight = await page.$eval(
      '[data-testid="scratchpad-canvas"]',
      (el) => el.getBoundingClientRect().height,
    );
    expect(fsHeight).toBeGreaterThan(300);

    // Escape exits full screen back to the inline panel, notes intact.
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="scratchpad-fullscreen"]', {
      hidden: true,
    });
    await page.waitForSelector('[data-testid="scratchpad-expand"]');
    await page.click('[data-testid="scratchpad-tab-write"]');
    const value = await page.$eval(
      '[data-testid="scratchpad-text"]',
      (el) => (el as HTMLTextAreaElement).value,
    );
    expect(value).toBe('big space');
  }, 60_000);
});

describe('home navigation', () => {
  it('links to progress, sticker cabinet, and settings', async () => {
    await waitForText(page, 'Solar System Practice');
    for (const [label, href] of [
      ['Progress', '/progress'],
      ['Sticker cabinet', '/stickers'],
      ['Settings', '/settings'],
    ]) {
      const link = await page.$(`a[aria-label="${label}"]`);
      expect(link, `${label} link`).toBeTruthy();
      const target = await page.evaluate(
        (el) => el.getAttribute('href'),
        link!,
      );
      expect(target).toContain(href);
    }
  });
});

describe('sticker cabinet page', () => {
  it('starts with every sticker locked, including per-category mastery', async () => {
    await page.goto(baseUrl() + '/stickers/');
    await waitForText(page, 'Sticker cabinet');

    const count = await page.$eval(
      '[data-testid="sticker-count"]',
      (el) => el.textContent ?? '',
    );
    expect(count).toMatch(/^0\s*\/\s*\d+ stickers$/);

    // Mastery tiles are generated from the demo pack's categories.
    for (const id of ['mastery-planets', 'mastery-space-exploration']) {
      const earned = await page.$eval(
        `[data-testid="sticker-${id}"]`,
        (el) => el.getAttribute('data-earned'),
      );
      expect(earned).toBe('false');
    }

    const body = await bodyText(page);
    expect(body).toContain('Hot streaks');
    expect(body).toContain('Category mastery');
    expect(body).toContain('Milestones');
  });

  it('taps a locked sticker to reveal how to unlock it, with progress', async () => {
    await page.goto(baseUrl() + '/stickers/');
    await waitForText(page, 'Sticker cabinet');

    // No detail open initially; the locked tile is a button.
    expect(await page.$('[data-testid="sticker-detail"]')).toBeNull();
    await page.click('[data-testid="sticker-volume-50"]');

    await page.waitForSelector('[data-testid="sticker-detail"]', {
      timeout: 10_000,
    });
    const detail = await page.$eval(
      '[data-testid="sticker-detail"]',
      (el) => el.textContent ?? '',
    );
    expect(detail).toContain('How to unlock');
    expect(detail).toContain('Answer 50 questions');
    expect(detail).toContain('questions answered');
    expect(detail).toMatch(/0\s*\/\s*50/); // no practice yet → 0 / 50
    expect(await page.$('[data-testid="sticker-detail-bar"]')).not.toBeNull();

    // Escape closes it.
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="sticker-detail"]'),
      { timeout: 10_000 },
    );
  });
});

describe('progress page', () => {
  it('shows the empty state before any practice', async () => {
    await page.goto(baseUrl() + '/progress/');
    await waitForText(page, 'No practice yet');
  });

  it('renders sessions, the daily streak, and weak spots from history', async () => {
    // Seeded session completed ~24h ago → a 1-day streak; the twice-wrong
    // question should surface as the top weak spot.
    await seedAttempts(page, [
      { questionId: 'demo-planets-001', subject: 'planets', topic: 'demo-planets-001', isCorrect: false, agoMs: 60_000 },
      { questionId: 'demo-planets-001', subject: 'planets', topic: 'demo-planets-001', isCorrect: false, agoMs: 50_000 },
      { questionId: 'demo-planets-002', subject: 'planets', topic: 'demo-planets-002', isCorrect: true, agoMs: 40_000 },
      { questionId: 'demo-planets-003', subject: 'planets', topic: 'demo-planets-003', isCorrect: true, agoMs: 30_000 },
    ]);
    await page.goto(baseUrl() + '/progress/');
    await page.waitForSelector('[data-testid="session-summary"]');

    // Session dashboard: the seed wrote one completed 60s session of 4
    // questions, so the tiles read 1 / 1m / 4 and exactly one weekday
    // bar is non-zero.
    const summary = await page.$eval(
      '[data-testid="session-summary"]',
      (el) => el.textContent ?? '',
    );
    expect(summary).toContain('1sessions');
    expect(summary).toContain('1mtypical length');
    expect(summary).toContain('4questions / session');

    const weekdayCounts = await page.$$eval(
      '[data-testid="weekday-chart"] [data-count]',
      (els) => els.map((el) => Number(el.getAttribute('data-count'))),
    );
    expect(weekdayCounts).toHaveLength(7);
    expect(weekdayCounts.reduce((a, b) => a + b, 0)).toBe(1);

    await page.waitForSelector('[data-testid="daily-streak"]');
    const streak = await page.$eval(
      '[data-testid="daily-streak"]',
      (el) => el.textContent ?? '',
    );
    expect(streak).toContain('1-day streak');

    // The demo declares an exam goal, so the standalone "By category" view
    // is hidden — per-category accuracy lives in the Exam-readiness section
    // (asserted in the readiness spec below), on the same cold-look metric.
    expect(await page.$('[data-testid="category-accuracy-planets"]')).toBeNull();

    const body = await bodyText(page);
    expect(body).toContain('Weak spots');
    expect(body).toContain('Practise');
  });

  it('estimates exam readiness once enough of the blueprint is covered', async () => {
    // The demo manifest declares an exam goal (70% pass). Cover both
    // domains with first attempts: planets 8/10, exploration 3/4. The
    // blueprint-weighted estimate is 78% — above the line, but the band's
    // low end dips below → a deterministic "likely" (on track) verdict.
    const planets = Array.from({ length: 10 }, (_, i) => ({
      questionId: `rp-${i}`, subject: 'planets', topic: `rp-${i}`,
      isCorrect: i < 8, agoMs: 60_000 - i * 100,
    }));
    const exploration = Array.from({ length: 4 }, (_, i) => ({
      questionId: `re-${i}`, subject: 'space-exploration', topic: `re-${i}`,
      isCorrect: i < 3, agoMs: 50_000 - i * 100,
    }));
    await seedAttempts(page, [...planets, ...exploration]);
    await page.goto(baseUrl() + '/progress/');
    await page.waitForSelector('[data-testid="exam-readiness"]');

    const verdict = await page.$eval(
      '[data-testid="readiness-verdict"]',
      (el) => el.getAttribute('data-verdict'),
    );
    expect(verdict).toBe('likely');

    // Both domains get a readiness row, and the headline shows the estimate.
    expect(await page.$('[data-testid="readiness-domain-planets"]')).not.toBeNull();
    expect(
      await page.$('[data-testid="readiness-domain-space-exploration"]'),
    ).not.toBeNull();
    const section = await page.$eval(
      '[data-testid="exam-readiness"]',
      (el) => el.textContent ?? '',
    );
    expect(section).toContain('Exam readiness');
    expect(section).toContain('78%'); // blueprint-weighted estimate
    expect(section).toContain('pass 70%'); // gauge pass-line label

    // The Home screen surfaces readiness as a third stat tile.
    await page.goto(baseUrl() + '/');
    await page.waitForSelector('[data-testid="exam-readiness-tile"]');
    const tile = await page.$eval(
      '[data-testid="exam-readiness-tile"]',
      (el) => el.textContent ?? '',
    );
    expect(tile).toContain('Readiness');
    expect(tile).toContain('78%'); // blueprint-weighted estimate
  });
});

describe('settings install card', () => {
  it('offers Add to Home Screen guidance', async () => {
    await page.goto(baseUrl() + '/settings/');
    await waitForText(page, 'Add to Home Screen');
    const body = await bodyText(page);
    expect(body).toContain('works offline');
  });
});

describe('schema v2 showcase (demo pack)', () => {
  it('renders the pack-defined level filter on the home page', async () => {
    await waitForText(page, 'Solar System Practice');
    const body = await bodyText(page);
    // levelsLabel + the two bands declared in the demo manifest.
    expect(body).toContain('Level');
    expect(body).toContain('Basics');
    expect(body).toContain('Advanced');
  });

  it('lists the pack source legend in Settings', async () => {
    await page.goto(baseUrl() + '/settings/');
    await waitForText(page, 'Question sources');
    const body = await bodyText(page);
    expect(body).toContain('NASA Science');
    expect(body).toContain('Hand-authored');
  });

  it('serves a pack image asset from /pack-assets/', async () => {
    const status = await page.evaluate(async () => {
      const r = await fetch('/pack-assets/saturn.svg');
      return r.status;
    });
    expect(status).toBe(200);
  });
});

describe('service worker', () => {
  it('registers and activates (powers the "new version ready" banner)', async () => {
    // resetOrigin unregistered any previous SW; UpdateNotifier re-registers
    // on mount. `ready` resolves once the new worker is activated.
    const state = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      // `ready` resolves with an active worker that may still be
      // 'activating' — wait out the transition.
      const reg = await navigator.serviceWorker.ready;
      const sw = reg.active;
      if (!sw) return 'none';
      if (sw.state !== 'activated') {
        await new Promise<void>((resolve) =>
          sw.addEventListener('statechange', () => {
            if (sw.state === 'activated') resolve();
          }),
        );
      }
      return sw.state;
    });
    expect(state).toBe('activated');
  }, 30_000);
});

describe('reward mini-games', () => {
  it('keeps games OFF the Home page (no nav icon, no banner)', async () => {
    await waitForText(page, 'Solar System Practice');
    // Games are a hidden easter egg — nothing on Home advertises them.
    expect(await page.$('a[aria-label="Games"]')).toBeNull();
    expect(await page.$('[data-testid="games-unlocked-banner"]')).toBeNull();
  });

  it('reveals games via the version-pill easter egg and plays one (free)', async () => {
    await page.goto(baseUrl() + '/settings/');
    await page.waitForSelector('[data-testid="app-version"]');
    // Not revealed until you tap the version pill enough times.
    expect(await page.$('[data-testid="games-easter-egg"]')).toBeNull();

    for (let i = 0; i < 7; i++) {
      await page.click('[data-testid="app-version"]');
    }
    await page.waitForSelector('[data-testid="games-easter-egg"]');

    // Follow the revealed link into the arcade — playable straight away,
    // no gate (finding the secret is the unlock).
    await page.click('[data-testid="games-easter-egg"] a[href="/games/"]');
    await page.waitForSelector('[data-testid="games-grid"]');

    // Open the sliding puzzle; the game shell + board should appear.
    await page.click('[data-testid="game-card-tile-puzzle"]');
    await page.waitForSelector('[data-testid="game-shell"]');
    await page.waitForSelector('[data-testid="tile-puzzle-board"]');

    // Close it; the grid is still there to play another.
    await page.click('button[aria-label="Close game"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="game-shell"]'),
    );
    await page.waitForSelector('[data-testid="games-grid"]');
  });
});
