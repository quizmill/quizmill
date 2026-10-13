import { expect, test } from '@playwright/test';
import {
  bodyText,
  clickButtonByText,
  pickOptionA,
  readStorage,
  seedAttempts,
  waitForText,
} from './helpers';

/**
 * End-to-end coverage for the generic pack variant, running against
 * the committed DEMO pack (content/pack-demo — solar system). Assumes
 * the static build is in `out/` (the prebuild ensure-pack hook seeds the
 * demo when no other pack is active). If a different pack was activated
 * locally via pack:use, these specs will fail — re-seed with:
 * rm -rf content/pack && npx tsx scripts/ensure-pack.ts
 */

const SCRATCHPAD_KEY = 'quizmill.solar-system-demo.scratchpad.v1';
const tid = (id: string) => `[data-testid="${id}"]`;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console]', msg.text());
  });
  await page.goto('/');
});

test.describe('pack home page', () => {
  test('renders the manifest title, subtitle, and category cards', async ({ page }) => {
    await waitForText(page, 'Solar System Practice');
    const body = await bodyText(page);
    expect(body).toContain('Pick a category');
    expect(body).toContain('Planets & Moons');
    expect(body).toContain('Space Exploration');
    // Manifest weights surface as chips (0.6 / 0.4).
    expect(body).toContain('60%');
    expect(body).toContain('40%');
  });

  test('shows the available question count per category', async ({ page }) => {
    await waitForText(page, /\d+ questions available/);
  });

  test('credits the engine with a link back to quizmill.dev', async ({ page }) => {
    await waitForText(page, /Built with\s+quizmill/);
    await expect(page.locator('footer a')).toHaveAttribute('href', 'https://quizmill.dev');
  });
});

test.describe('pack practice flow', () => {
  test('runs a complete session and lands on the results screen', async ({ page }) => {
    await page.goto('/practice/?subject=planets');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

    const total = Number((await bodyText(page)).match(/Q\s*1\s*\/\s*(\d+)/)?.[1] ?? 0);
    expect(total).toBeGreaterThan(0);

    for (let i = 0; i < total; i++) {
      await pickOptionA(page);
      await clickButtonByText(page, 'Check answer');
      await waitForText(page, /Correct\.|Not quite\./);
      await clickButtonByText(page, i === total - 1 ? 'See results' : 'Next question');
    }

    // Finishing the first session unlocks the 'First steps' sticker —
    // the celebration toast renders with the results screen (and
    // auto-dismisses ~2s later, hence the immediate wait).
    await page.locator(tid('celebration')).waitFor({ timeout: 5_000 });

    await waitForText(page, 'Practice complete');
    const resultBody = await bodyText(page);
    expect(resultBody).toMatch(new RegExp(`\\d+\\/${total}`));
    expect(resultBody).toMatch(/\d+% correct/);

    // ...and the cabinet now shows it as earned.
    await page.goto('/stickers/');
    await waitForText(page, 'Sticker cabinet');
    await expect(page.locator(tid('sticker-first-session'))).toHaveAttribute('data-earned', 'true');
  });

  test('answered count persists to the home page and the vote row shows in feedback', async ({ page }) => {
    await page.goto('/practice/?subject=planets');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

    // Answer one question and check the feedback panel carries the
    // vote row (question feedback works for pack content too).
    await pickOptionA(page);
    await clickButtonByText(page, 'Check answer');
    await waitForText(page, /Correct\.|Not quite\./);
    await expect(page.locator(tid('vote-row'))).toBeVisible();

    // Attempts persist under the pack variant's own namespace.
    const attempts = await readStorage<{ subject: string }[]>(
      page,
      'quizmill.solar-system-demo.attempts.v1',
    );
    expect(attempts).toHaveLength(1);
    expect(attempts![0].subject).toBe('planets');
  });
});

test.describe('scratchpad', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/practice/?subject=planets');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);
  });

  test('keeps working notes across questions and clears on demand', async ({ page }) => {
    const text = page.locator(tid('scratchpad-text'));
    // Collapsed by default — the textarea isn't mounted until opened.
    await expect(text).toHaveCount(0);

    await page.click(tid('scratchpad-toggle'));
    await text.fill('7 x 8 = 56');

    // Persisted under the pack's own namespace (text + open state).
    expect(await readStorage(page, SCRATCHPAD_KEY)).toMatchObject({
      text: '7 x 8 = 56',
      open: true,
    });

    // Answer and advance — the note and open state survive the question change.
    await pickOptionA(page);
    await clickButtonByText(page, 'Check answer');
    await waitForText(page, /Correct\.|Not quite\./);
    await clickButtonByText(page, 'Next question');
    await waitForText(page, /Q\s*2\s*\/\s*\d+/);
    await expect(text).toHaveValue('7 x 8 = 56');

    // Clear empties both the field and the stored note.
    await page.click(tid('scratchpad-clear'));
    await expect(text).toHaveValue('');
    expect((await readStorage<{ text: string }>(page, SCRATCHPAD_KEY))!.text).toBe('');
  });

  test('draws strokes on the canvas, persists them, and undo/clear work', async ({ page }) => {
    type Pad = { mode: string; color: string; strokes: { points: { x: number; y: number }[] }[] };
    const pad = async () => (await readStorage<Pad>(page, SCRATCHPAD_KEY))!;

    await page.click(tid('scratchpad-toggle'));
    await page.click(tid('scratchpad-tab-draw'));
    const box = (await page.locator(tid('scratchpad-canvas')).boundingBox())!;

    // Drag a short stroke across the canvas with the mouse (which fires
    // pointer events in Chrome).
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 40, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 20);
    await page.mouse.move(cx + 40, cy + 10);
    await page.mouse.up();

    const afterDraw = await pad();
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
    await page.locator(`${tid('scratchpad-palette')} button`).nth(1).click();
    expect((await pad()).color).toBe('#3b78e0');

    // A second stroke, then undo drops back to one.
    await page.mouse.move(cx - 30, cy + 30);
    await page.mouse.down();
    await page.mouse.move(cx + 30, cy + 30);
    await page.mouse.up();
    expect((await pad()).strokes.length).toBe(2);

    await page.click(tid('scratchpad-undo'));
    expect((await pad()).strokes.length).toBe(1);

    await page.click(tid('scratchpad-clear-draw'));
    expect((await pad()).strokes.length).toBe(0);
  });

  test('expands to full screen for more space, and collapses back', async ({ page }) => {
    await page.click(tid('scratchpad-toggle'));

    // Enter full screen — the overlay appears and the inline expand button goes.
    await page.click(tid('scratchpad-expand'));
    await expect(page.locator(tid('scratchpad-fullscreen'))).toBeVisible();
    await expect(page.locator(tid('scratchpad-expand'))).toHaveCount(0);

    // Typing in the full-screen pad writes to the same per-pack entry.
    await page.locator(tid('scratchpad-text')).fill('big space');
    expect((await readStorage<{ text: string }>(page, SCRATCHPAD_KEY))!.text).toBe('big space');

    // The full-screen canvas is far taller than the inline 192px box.
    await page.click(tid('scratchpad-tab-draw'));
    const fs = (await page.locator(tid('scratchpad-canvas')).boundingBox())!;
    expect(fs.height).toBeGreaterThan(300);

    // Escape exits full screen back to the inline panel, notes intact.
    await page.keyboard.press('Escape');
    await expect(page.locator(tid('scratchpad-fullscreen'))).toBeHidden();
    await page.click(tid('scratchpad-tab-write'));
    await expect(page.locator(tid('scratchpad-text'))).toHaveValue('big space');
  });
});

test('scratchpad opens a pad saved by an older build (text only, no strokes/mode)', async ({ page }) => {
  // Seed the pre-draw storage shape before loading the runner.
  await page.addInitScript((k) => {
    localStorage.setItem(k, JSON.stringify({ text: 'legacy note', open: true }));
  }, SCRATCHPAD_KEY);
  await page.goto('/practice/?subject=planets');
  await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);

  // Opens straight onto the Write tab with the old note intact, no crash.
  await expect(page.locator(tid('scratchpad-text'))).toHaveValue('legacy note');

  // Draw tab is available and starts empty.
  await page.click(tid('scratchpad-tab-draw'));
  await expect(page.locator(tid('scratchpad-canvas'))).toBeVisible();
  await expect(page.locator(tid('scratchpad-undo'))).toBeDisabled();
});

test.describe('tab bar navigation', () => {
  test('offers Home, Progress, Stickers, Notes and Settings on every tab route', async ({ page }) => {
    await waitForText(page, 'Solar System Practice');
    const bar = page.locator('nav[aria-label="Main"]');
    for (const [label, href] of [
      ['Home', '/'],
      ['Progress', '/progress'],
      ['Stickers', '/stickers'],
      ['Notes', '/notes'],
      ['Settings', '/settings'],
    ]) {
      await expect(bar.getByRole('link', { name: label }), `${label} tab`).toHaveAttribute(
        'href',
        new RegExp(`^${href}/?$`),
      );
    }
    await expect(bar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    // Tabs are real navigation; the destination highlights its own tab.
    await bar.getByRole('link', { name: 'Progress' }).click();
    await waitForText(page, 'No practice yet');
    await expect(bar.getByRole('link', { name: 'Progress' })).toHaveAttribute('aria-current', 'page');
  });

  test('stays out of a practice session', async ({ page }) => {
    await page.goto('/practice/?subject=planets');
    await waitForText(page, /Q\s*1\s*\/\s*\d+/, 20_000);
    await expect(page.locator('nav[aria-label="Main"]')).toHaveCount(0);
  });
});

test.describe('sticker cabinet page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/stickers/');
    await waitForText(page, 'Sticker cabinet');
  });

  test('starts with every sticker locked, including per-category mastery', async ({ page }) => {
    await expect(page.locator(tid('sticker-count'))).toHaveText(/^0\s*\/\s*\d+ stickers$/);

    // Mastery tiles are generated from the demo pack's categories.
    for (const id of ['mastery-planets', 'mastery-space-exploration']) {
      await expect(page.locator(tid(`sticker-${id}`))).toHaveAttribute('data-earned', 'false');
    }

    const body = await bodyText(page);
    expect(body).toContain('Hot streaks');
    expect(body).toContain('Category mastery');
    expect(body).toContain('Milestones');
  });

  test('taps a locked sticker to reveal how to unlock it, with progress', async ({ page }) => {
    const detail = page.locator(tid('sticker-detail'));
    // No detail open initially; the locked tile is a button.
    await expect(detail).toHaveCount(0);
    await page.click(tid('sticker-volume-50'));

    await expect(detail).toContainText('How to unlock');
    await expect(detail).toContainText('Answer 50 questions');
    await expect(detail).toContainText('questions answered');
    await expect(detail).toContainText(/0\s*\/\s*50/); // no practice yet → 0 / 50
    await expect(page.locator(tid('sticker-detail-bar'))).toHaveCount(1);

    // Escape closes it.
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
  });
});

test.describe('progress page', () => {
  test('shows the empty state before any practice', async ({ page }) => {
    await page.goto('/progress/');
    await waitForText(page, 'No practice yet');
  });

  test('renders sessions, the daily streak, and weak spots from history', async ({ page }) => {
    // A full round (10 questions) today → a 1-day streak (the streak follows
    // practice activity, not whether a session was finished); the twice-wrong
    // demo-planets-001 should surface as the top weak spot (the only question
    // with the 2-attempt minimum).
    await seedAttempts(page, [
      { questionId: 'demo-planets-001', subject: 'planets', topic: 'demo-planets-001', isCorrect: false, agoMs: 60_000 },
      { questionId: 'demo-planets-001', subject: 'planets', topic: 'demo-planets-001', isCorrect: false, agoMs: 59_000 },
      ...Array.from({ length: 8 }, (_, i) => ({
        questionId: `demo-planets-00${i + 2}`,
        subject: 'planets',
        topic: `demo-planets-00${i + 2}`,
        isCorrect: true,
        agoMs: 50_000 - i * 100,
      })),
    ]);
    await page.goto('/progress/');

    // Session dashboard: the seed wrote one completed 60s session of 10
    // questions, so the tiles read 1 / 1 min / 10 and exactly one weekday
    // bar is non-zero.
    const summary = page.locator(tid('session-summary'));
    await expect(summary).toContainText('1sessions');
    await expect(summary).toContainText('1 mintypical length');
    await expect(summary).toContainText('10questions / session');

    const bars = page.locator(`${tid('weekday-chart')} [data-count]`);
    await expect(bars).toHaveCount(7);
    const counts = await bars.evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-count'))));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);

    // The level/streak card (moved here from Home) shows the live streak.
    await expect(page.locator(tid('streak-card'))).toContainText('1-day streak');

    // The demo declares an exam goal, so the standalone "By category" view
    // is hidden — per-category accuracy lives in the Exam-readiness section
    // (asserted in the readiness spec below), on the same cold-look metric.
    await expect(page.locator(tid('category-accuracy-planets'))).toHaveCount(0);

    const body = await bodyText(page);
    expect(body).toContain('Weak spots');
    expect(body).toContain('Practise');
  });

  test('estimates exam readiness once enough of the blueprint is covered', async ({ page }) => {
    // The demo manifest declares an exam goal (70% pass). Cover both
    // domains fully with first attempts (the "judged" gate is
    // min(12, bank size), so a domain must be answered end-to-end):
    // planets 11/13, exploration 3/5. Blueprint weights are 0.6/0.4, so
    // the estimate is 0.6·84.6% + 0.4·60% ≈ 75% — above the line, but the
    // band's low end dips below → a deterministic "likely" verdict.
    const planets = Array.from({ length: 13 }, (_, i) => ({
      questionId: `rp-${i}`, subject: 'planets', topic: `rp-${i}`,
      isCorrect: i < 11, agoMs: 60_000 - i * 100,
    }));
    const exploration = Array.from({ length: 5 }, (_, i) => ({
      questionId: `re-${i}`, subject: 'space-exploration', topic: `re-${i}`,
      isCorrect: i < 3, agoMs: 50_000 - i * 100,
    }));
    await seedAttempts(page, [...planets, ...exploration]);
    await page.goto('/progress/');

    await expect(page.locator(tid('readiness-verdict'))).toHaveAttribute('data-verdict', 'likely');

    // Both domains get a readiness row, and the headline shows the estimate.
    await expect(page.locator(tid('readiness-domain-planets'))).toHaveCount(1);
    await expect(page.locator(tid('readiness-domain-space-exploration'))).toHaveCount(1);
    const section = page.locator(tid('exam-readiness'));
    await expect(section).toContainText('Exam readiness');
    await expect(section).toContainText('75%'); // blueprint-weighted estimate
    await expect(section).toContainText('pass 70%'); // gauge pass-line label

    // Home carries no readiness tile any more (#188): status is the
    // Progress tab's; Home keeps only the streak chip.
    await page.goto('/');
    await waitForText(page, 'Solar System Practice');
    await expect(page.locator(tid('exam-readiness-tile'))).toHaveCount(0);
    await expect(page.locator(tid('streak-chip'))).toContainText('1-day streak');
  });
});

test.describe('settings install card', () => {
  test('offers Add to Home Screen guidance', async ({ page }) => {
    await page.goto('/settings/');
    await waitForText(page, 'Add to Home Screen');
    await waitForText(page, 'works offline');
  });
});

test.describe('schema v2 showcase (demo pack)', () => {
  test('renders the pack-defined level filter on the home page', async ({ page }) => {
    await waitForText(page, 'Solar System Practice');
    const body = await bodyText(page);
    // levelsLabel + the two bands declared in the demo manifest.
    expect(body).toContain('Level');
    expect(body).toContain('Basics');
    expect(body).toContain('Advanced');
  });

  test('lists the pack source legend in Settings', async ({ page }) => {
    await page.goto('/settings/');
    await waitForText(page, 'Question sources');
    const body = await bodyText(page);
    expect(body).toContain('NASA Science');
    expect(body).toContain('Hand-authored');
  });

  test('serves a pack image asset from /pack-assets/', async ({ request }) => {
    expect((await request.get('/pack-assets/saturn.svg')).status()).toBe(200);
  });
});

test.describe('service worker', () => {
  test('registers and activates (powers the "new version ready" banner)', async ({ page }) => {
    // Fresh context → no prior SW; UpdateNotifier registers on mount.
    // `ready` resolves once a worker is active (it may still be
    // 'activating' — wait out the transition).
    const state = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const sw = (await navigator.serviceWorker.ready).active;
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
  });
});

test.describe('reward mini-games', () => {
  test('keeps games OFF the Home page (no nav icon, no banner)', async ({ page }) => {
    await waitForText(page, 'Solar System Practice');
    // Games are a hidden easter egg — nothing on Home advertises them.
    await expect(page.locator('a[aria-label="Games"]')).toHaveCount(0);
    await expect(page.locator(tid('games-unlocked-banner'))).toHaveCount(0);
  });

  test('reveals games via the version-pill easter egg and plays one (free)', async ({ page }) => {
    await page.goto('/settings/');
    const egg = page.locator(tid('games-easter-egg'));
    await expect(page.locator(tid('app-version'))).toBeVisible();
    // Not revealed until you tap the version pill enough times.
    await expect(egg).toHaveCount(0);

    // Tap until it reveals (needs 7, stays revealed). Clicks can outrun
    // hydration — the handler isn't attached yet, so early taps are lost —
    // which made a blind 7-tap loop flaky. Tap-and-poll instead.
    await expect(async () => {
      await page.click(tid('app-version'));
      await expect(egg).toBeVisible({ timeout: 100 });
    }).toPass({ timeout: 10_000, intervals: [0] });

    // The find is remembered on the device: back in Settings, the card
    // is still there without tapping again.
    await page.reload();
    await expect(egg).toBeVisible();

    // Follow the revealed link into the arcade — playable straight away,
    // no gate (finding the secret is the unlock).
    await egg.locator('a[href="/games/"]').click();
    await expect(page.locator(tid('games-grid'))).toBeVisible();

    // Open the sliding puzzle; the game shell + board should appear.
    await page.click(tid('game-card-tile-puzzle'));
    await expect(page.locator(tid('game-shell'))).toBeVisible();
    await expect(page.locator(tid('tile-puzzle-board'))).toBeVisible();

    // Close it; the grid is still there to play another.
    await page.click('button[aria-label="Close game"]');
    await expect(page.locator(tid('game-shell'))).toHaveCount(0);
    await expect(page.locator(tid('games-grid'))).toBeVisible();
  });

  test('gates the arcade on the ACTIVE pack, not the pack the build was made from', async ({ page }) => {
    // The static export prerenders /games once, from the demo pack (which
    // has games). A pack handed to the engine at runtime must get its own
    // answer there: this one has no `games` block, so no grid — a plain
    // "no games" card instead of a dead link. (The inverse — a games pack
    // swapped into an app built without games — is the same decision made
    // in the browser; it can't be staged against this build.)
    await page.evaluate(() => {
      const manifest = {
        schemaVersion: 2,
        id: 'runtime-no-games',
        title: 'Runtime pack without games',
        description: 'Injected at runtime.',
        homeSubtitle: 'No arcade here',
        themeColor: '#3b78e0',
        categories: [{ key: 'basics', label: 'Basics' }],
      };
      localStorage.setItem('quizmill.activePack', JSON.stringify({ manifest, questions: [] }));
    });
    await page.goto('/games/');
    await expect(page.locator(tid('games-none'))).toBeVisible();
    await expect(page.locator(tid('games-grid'))).toHaveCount(0);
    await waitForText(page, 'No games in this pack');
  });
});
