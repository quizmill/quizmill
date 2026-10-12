import { expect, test, type Page } from '@playwright/test';
import { clickButtonByText, pickOptionA, readStorage, seedAttempts, waitForText } from './helpers';

/**
 * Paper practice, end to end against the demo pack: compose a sheet,
 * REOPEN it from the list by clicking its row (a real-browser
 * regression: a next/link hash href navigates via pushState and never
 * fires the `hashchange` the page keys off, so only a native anchor
 * works — no unit test drives the router, so it lives here), then mark
 * answers back in and see them recorded.
 */

const ATTEMPTS_KEY = 'quizmill.solar-system-demo.attempts.v1';
const SESSIONS_KEY = 'quizmill.solar-system-demo.sessions.v1';
const tid = (id: string) => `[data-testid="${id}"]`;

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto('/paper/', { waitUntil: 'networkidle' });
});

async function createSheet(page: Page): Promise<void> {
  await clickButtonByText(page, 'Create sheet');
  await expect(page.locator(tid('paper-sheet'))).toBeVisible();
}

test('reopens a stored sheet by clicking its row in the list', async ({ page }) => {
  await createSheet(page);

  // The tab title carries the sheet stamp while it's open — it's what
  // browsers use as the "Save as PDF" filename, so every sheet's PDF
  // gets a unique name (code + date).
  const code = (await page.locator(`${tid('paper-sheet')} .font-mono`).first().textContent())?.trim();
  expect(code).toMatch(/^P-/);
  expect(await page.title()).toContain(` - ${code} - `);
  expect(await page.title()).toMatch(/\d{4}-\d{2}-\d{2}$/);

  // Back to the list, then REOPEN via the row — the click that only
  // works with native hash navigation.
  await clickButtonByText(page, 'Sheets');
  await expect(page.locator(tid('paper-sheet-list'))).toBeVisible();
  await expect(page.locator(tid('paper-sheet'))).toHaveCount(0);
  await page.click(tid(`sheet-row-${code}`));
  await expect(page.locator(tid('paper-sheet'))).toBeVisible({ timeout: 5_000 });
  await waitForText(page, 'Print / PDF');

  // Leaving the sheet restores the app title.
  await clickButtonByText(page, 'Sheets');
  await expect(page.locator(tid('paper-sheet-list'))).toBeVisible();
  expect(await page.title()).not.toContain(String(code));
});

test('prints a QR a camera can actually decode, and it opens the marking page', async ({ page }) => {
  await clickButtonByText(page, 'Create sheet');
  await page.locator(`${tid('paper-sheet')} svg path`).first().waitFor();

  // "Scan" the QR the way a phone does: rasterise the SVG at roughly
  // its printed resolution (36mm at 300dpi ≈ 425px) and run jsQR over
  // the pixels. This is the regression net for payload density and
  // the quiet zone — an unscannable code fails here, not at the
  // kitchen table.
  await page.addScriptTag({ path: 'node_modules/jsqr/dist/jsQR.js' });
  const decoded = await page.evaluate(async () => {
    const svg = document.querySelector('[data-testid="paper-sheet"] svg')!;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    await loaded;
    const SIZE = 425;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const data = ctx.getImageData(0, 0, SIZE, SIZE);
    type JsQr = (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null;
    return (window as unknown as { jsQR: JsQr }).jsQR(data.data, SIZE, SIZE)?.data ?? null;
  });

  expect(decoded).not.toBeNull();
  expect(decoded).toContain('/paper/mark/#s=2.');

  // The decoded URL is the whole loop: opening it lands on marking.
  await page.goto(decoded!, { waitUntil: 'networkidle' });
  await expect(page.locator(tid('mark-rows'))).toBeVisible();
  await waitForText(page, /P-[A-Z2-9]{4}/);
});

test('prints an answer key for the coach under its own PDF name', async ({ page }) => {
  await createSheet(page);
  await page.click(tid('view-key'));
  await expect(page.locator(tid('paper-answer-key'))).toBeVisible();
  await expect(page.locator(tid('paper-sheet'))).toHaveCount(0);
  await expect(page).toHaveTitle(/ - answer key$/);
  const answers = page.locator(tid('key-answer'));
  await expect(answers).toHaveCount(10);
  for (const a of await answers.allTextContents()) {
    expect(a.trim()).toMatch(/^[A-F](,[A-F])*$/);
  }
});

test('marks a sheet back in and records a paper session', async ({ page }) => {
  await createSheet(page);
  await page.click(tid('mark-sheet'));
  await expect(page.locator(tid('mark-rows'))).toBeVisible();

  await page.click('[aria-label="Question 1: answer A"]');
  await page.click('[aria-label="Question 2: answer B"]');
  await page.click(tid('save-marks'));
  await expect(page.locator(tid('mark-saved'))).toBeVisible();
  await waitForText(page, /[0-2]\/2 correct/);

  const sessions = (await readStorage<{ mode: string }[]>(page, SESSIONS_KEY))!;
  const attempts = (await readStorage<{ mode: string }[]>(page, ATTEMPTS_KEY))!;
  expect(sessions).toHaveLength(1);
  expect(sessions[0].mode).toBe('paper');
  expect(attempts).toHaveLength(2);
  expect(attempts.every((a) => a.mode === 'paper')).toBe(true);

  // The list now shows the sheet as marked.
  await page.goto('/paper/', { waitUntil: 'networkidle' });
  await expect(page.locator(tid('paper-sheet-list'))).toBeVisible();
  await waitForText(page, 'Marked');
});

test('writes on a sheet on screen: ink lands where the pen went and survives a reload', async ({ page }) => {
  await createSheet(page);
  await page.click(tid('write-sheet'));
  await expect(page.locator(tid('ink-surface'))).toBeVisible();

  const rectOf = async (sel: string) => (await page.locator(sel).boundingBox())!;

  // A tick inside the first answer box, with a real pointer.
  const box = await rectOf(tid('answer-box-1'));
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.75, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.25, { steps: 6 });
  await page.mouse.up();

  // The stroke is drawn inside that box — the page is a scaled,
  // fixed-width layout, so this is the coordinate mapping end to end.
  const inside = async () => {
    const ink = await rectOf(tid('ink-stroke'));
    const b = await rectOf(tid('answer-box-1'));
    return (
      ink.x >= b.x &&
      ink.y >= b.y &&
      ink.x + ink.width <= b.x + b.width &&
      ink.y + ink.height <= b.y + b.height
    );
  };
  await expect(page.locator(tid('ink-stroke'))).toHaveCount(1);
  expect(await inside()).toBe(true);

  // Saved as it landed: a reload brings the sheet back with its ink,
  // still in the box.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator(tid('ink-stroke'))).toHaveCount(1);
  expect(await inside()).toBe(true);

  // Finished → the foot of the page leads to marking this very sheet.
  const code = (await page.locator(`${tid('write-finish')} .font-mono`).first().textContent())!.trim();
  await page.click(tid('write-mark-here'));
  await expect(page.locator(tid('mark-rows'))).toBeVisible();
  await waitForText(page, code);
});

test("reviews the sheet's own mistakes, not the older ones in the queue", async ({ page }) => {
  // Two stale mistakes head the global review queue (oldest first) —
  // the regression: "Review the mistakes together" opened on those
  // instead of the question the sheet just got wrong.
  await seedAttempts(page, [
    { questionId: 'demo-explore-001', subject: 'space-exploration', topic: 'demo-explore-001', isCorrect: false, agoMs: 7 * 24 * 3600_000 },
    { questionId: 'demo-explore-002', subject: 'space-exploration', topic: 'demo-explore-002', isCorrect: false, agoMs: 6 * 24 * 3600_000 },
  ]);

  await createSheet(page);
  // Read the right answers off the coach's key, so Q1 can be marked
  // wrong and Q2 right whatever the sheet dealt.
  await page.click(tid('view-key'));
  await expect(page.locator(tid('key-answer')).first()).toBeVisible();
  const key = (await page.locator(tid('key-answer')).allTextContents()).map((t) => t.trim());
  await page.click(tid('view-sheet'));
  await page.click(tid('mark-sheet'));
  await expect(page.locator(tid('mark-rows'))).toBeVisible();

  // One letter that isn't the whole answer is wrong for single- and
  // multi-answer questions alike.
  await page.click(`[aria-label="Question 1: answer ${key[0] === 'A' ? 'B' : 'A'}"]`);
  for (const letter of key[1].split(',')) {
    await page.click(`[aria-label="Question 2: answer ${letter}"]`);
  }
  await page.click(tid('save-marks'));
  await expect(page.locator(tid('mark-saved'))).toBeVisible();
  await waitForText(page, '1/2 correct');

  await clickButtonByText(page, 'Review the mistakes together');
  await waitForText(page, 'Q 1 / 1');

  // Answer it: the review attempt lands on the sheet's Q1.
  await pickOptionA(page);
  await clickButtonByText(page, 'Check answer');
  await waitForText(page, 'See results');
  const attempts = (await readStorage<{ id: string; mode?: string; questionId: string }[]>(
    page,
    ATTEMPTS_KEY,
  ))!;
  const sheetQ1 = attempts.find((a) => a.mode === 'paper' && a.id.endsWith(':a1'));
  const reviewed = attempts.filter((a) => a.mode === 'review');
  expect(reviewed).toHaveLength(1);
  expect(reviewed[0].questionId).toBe(sheetQ1?.questionId);
});
