import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seededRng } from '@/lib/selection';
import {
  answerBoxLabel,
  buildPaperResult,
  composePaperSheet,
  decodePaperPayload,
  deletePaperSheet,
  encodePaperPayload,
  getPaperSheet,
  loadPaperSheets,
  newSheetCode,
  payloadFromSheet,
  recordSheetMarked,
  resolveSheetQuestions,
  savePaperSheet,
  sheetFromPayload,
  MAX_STORED_SHEETS,
  type PaperMark,
  type PaperSheet,
} from '@/pack/paper';
import type { PackQuestion } from '@/pack/data';

function question(id: string, over: Partial<PackQuestion> = {}): PackQuestion {
  return {
    id,
    categoryKey: 'planets',
    difficulty: 2,
    prompt: `Prompt for ${id}`,
    options: [
      { key: 'A', text: 'one' },
      { key: 'B', text: 'two' },
      { key: 'C', text: 'three' },
      { key: 'D', text: 'four' },
    ],
    correctKey: 'B',
    explanation: 'because',
    source: 'original',
    reviewStatus: 'approved',
    ...over,
  };
}

function sheet(over: Partial<PaperSheet> = {}): PaperSheet {
  return {
    id: 'sheet-1111',
    code: 'P-TEST',
    createdAt: 1_700_000_000_000,
    categoryKey: 'planets',
    questionIds: ['q1', 'q2', 'q3'],
    ...over,
  };
}

describe('newSheetCode', () => {
  it('produces a P- prefixed 4-char code from the unambiguous alphabet', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(newSheetCode(seededRng(seed))).toMatch(
        /^P-[ACDEFHJKMNPQRTUVWXYZ234679]{4}$/,
      );
    }
  });

  it('is deterministic for a given rng', () => {
    expect(newSheetCode(seededRng(7))).toBe(newSheetCode(seededRng(7)));
  });
});

describe('composePaperSheet', () => {
  const bank = ['q1', 'q2', 'q3', 'q4', 'q5'].map((id) => question(id));

  it('returns null for an empty bank', () => {
    expect(
      composePaperSheet([], new Map(), { categoryKey: 'planets', count: 10 }),
    ).toBeNull();
  });

  it('picks `count` questions and records their ids in order', () => {
    const out = composePaperSheet(bank, new Map(), {
      categoryKey: 'planets',
      count: 3,
      rng: seededRng(1),
      id: 'fixed-id',
      code: 'P-FIXD',
      now: 123,
    });
    expect(out).not.toBeNull();
    expect(out!.questions).toHaveLength(3);
    expect(out!.sheet).toMatchObject({
      id: 'fixed-id',
      code: 'P-FIXD',
      createdAt: 123,
      categoryKey: 'planets',
    });
    expect(out!.sheet.questionIds).toEqual(out!.questions.map((q) => q.id));
    expect(out!.sheet.level).toBeUndefined();
  });

  it('clamps to the bank size and prefers unseen questions', () => {
    const history = new Map([
      ['q1', { lastAnsweredAt: 10, lastCorrect: true }],
      ['q2', { lastAnsweredAt: 20, lastCorrect: true }],
      ['q3', { lastAnsweredAt: 30, lastCorrect: true }],
    ]);
    const out = composePaperSheet(bank, history, {
      categoryKey: 'planets',
      count: 2,
      rng: seededRng(2),
    });
    // Two unseen questions exist (q4, q5) — a 2-question sheet is exactly them.
    expect(out!.sheet.questionIds.slice().sort()).toEqual(['q4', 'q5']);

    const all = composePaperSheet(bank, new Map(), {
      categoryKey: 'planets',
      count: 99,
      rng: seededRng(3),
    });
    expect(all!.questions).toHaveLength(bank.length);
  });

  it('stores the level filter it was composed with', () => {
    const out = composePaperSheet(bank, new Map(), {
      categoryKey: 'planets',
      count: 2,
      level: 'y4',
      rng: seededRng(4),
    });
    expect(out!.sheet.level).toBe('y4');
  });
});

describe('paper payload encode/decode', () => {
  it('round-trips a sheet through the QR payload', async () => {
    const s = sheet({ questionIds: ['q-ünïcode', 'q2'] });
    const payload = payloadFromSheet(s, 'my-pack');
    const decoded = await decodePaperPayload(await encodePaperPayload(payload));
    expect(decoded).toEqual(payload);
    expect(sheetFromPayload(decoded!)).toEqual({
      id: s.id,
      code: s.code,
      createdAt: s.createdAt,
      categoryKey: s.categoryKey,
      questionIds: ['q-ünïcode', 'q2'],
    });
  });

  it('survives a URL fragment: "2." + base64url, no +, / or =', async () => {
    const encoded = await encodePaperPayload(
      payloadFromSheet(sheet({ questionIds: Array(40).fill('q?~x') }), 'p'),
    );
    expect(encoded).toMatch(/^2\.[A-Za-z0-9_-]+$/);
  });

  it('still decodes the legacy uncompressed form (already-printed sheets)', async () => {
    const payload = payloadFromSheet(sheet({ questionIds: ['q-ünïcode', 'q2'] }), 'p');
    // What pre-compression builds printed: plain base64url of the JSON.
    const legacy = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(await decodePaperPayload(legacy)).toEqual(payload);
  });

  it('keeps a realistic worst-case sheet scannable when printed', async () => {
    // 20 long real-world ids (shared prefix, like eleven-plus banks).
    const ids = Array.from(
      { length: 20 },
      (_, i) => `eleven-plus-nonverbal-y6-question-${i + 100}`,
    );
    const payload = payloadFromSheet(
      sheet({ id: crypto.randomUUID(), questionIds: ids, categoryKey: 'nonverbal' }),
      'eleven-plus',
    );
    const url = `https://leven.quizmill.dev/paper/mark/#s=${await encodePaperPayload(payload)}`;
    const qrcodegen = (await import('qrcode-generator')).default;
    const qr = qrcodegen(0, 'M');
    qr.addData(url, 'Byte');
    qr.make();
    // ≤ 77 modules (version 15) keeps every module ≥ ~0.4mm at the
    // printed 36mm incl. quiet zone — the floor phone cameras resolve.
    // The uncompressed form measured 137 modules (0.18mm): unscannable.
    expect(qr.getModuleCount()).toBeLessThanOrEqual(77);
  });

  it('rejects garbage, wrong versions and missing fields', async () => {
    expect(await decodePaperPayload('not base64 at all!!')).toBeNull();
    expect(await decodePaperPayload('2.@@not-deflate@@')).toBeNull();
    expect(await decodePaperPayload(btoa('{"v":1}'))).toBeNull();
    expect(await decodePaperPayload(btoa(JSON.stringify({ v: 2 })))).toBeNull();
    const good = payloadFromSheet(sheet(), 'p');
    const enc = (obj: object) => btoa(JSON.stringify(obj));
    expect(await decodePaperPayload(enc({ ...good, qs: [] }))).toBeNull();
    expect(await decodePaperPayload(enc({ ...good, qs: [1, 2] }))).toBeNull();
    expect(await decodePaperPayload(enc({ ...good, t: 'yesterday' }))).toBeNull();
  });
});

describe('resolveSheetQuestions', () => {
  it('keeps order and marks ids the pack no longer has', () => {
    const bank = [question('q1'), question('q3')];
    const marks = resolveSheetQuestions(['q1', 'q2', 'q3'], bank);
    expect(marks.map((m) => m.questionId)).toEqual(['q1', 'q2', 'q3']);
    expect(marks[0].question?.id).toBe('q1');
    expect(marks[1].question).toBeNull();
    expect(marks[2].question?.id).toBe('q3');
    expect(marks.every((m) => m.selected === null)).toBe(true);
  });
});

describe('buildPaperResult', () => {
  const q1 = question('q1', { correctKey: 'B' });
  const q2 = question('q2', {
    correctKey: undefined,
    correctKeys: ['A', 'C'],
    scenarioId: 'scen-1',
  });
  const q3 = question('q3', { correctKey: 'D', difficulty: 4 });
  const s = sheet();
  const NOW = 1_800_000_000_000;

  it('grades, skips unanswered rows, and builds deterministic ids', () => {
    const marks: PaperMark[] = [
      { questionId: 'q1', question: q1, selected: ['B'] },
      // multi-answer written out of order — grading is set-based,
      // storage is the sorted comma-joined string.
      { questionId: 'q2', question: q2, selected: ['C', 'A'] },
      { questionId: 'q3', question: q3, selected: null },
    ];

    const out = buildPaperResult(s, marks, NOW);
    expect(out.answeredCount).toBe(2);
    expect(out.correctCount).toBe(2);
    expect(out.attempts).toHaveLength(2);

    const [a1, a2] = out.attempts;
    expect(a1).toMatchObject({
      id: 'sheet-1111:a1',
      sessionId: 'sheet-1111',
      questionId: 'q1',
      selectedAnswer: 'B',
      isCorrect: true,
      timeTakenSeconds: 1,
      subject: 'planets',
      topic: 'q1',
      position: 1,
      mode: 'paper',
      answeredAt: NOW,
    });
    expect(a1.scenarioId).toBeUndefined();
    expect(a2).toMatchObject({
      id: 'sheet-1111:a2',
      questionId: 'q2',
      selectedAnswer: 'A,C',
      isCorrect: true,
      position: 2,
      scenarioId: 'scen-1',
      answeredAt: NOW + 1,
    });

    expect(out.session).toMatchObject({
      id: 'sheet-1111',
      subject: 'planets',
      startedAt: s.createdAt,
      questionCount: 3,
      correctCount: 2,
      mode: 'paper',
    });
    expect(out.session.endedAt).toBe(NOW + 3);
  });

  it('marks wrong and partial multi-answers wrong (all-or-nothing)', () => {
    const marks: PaperMark[] = [
      { questionId: 'q1', question: q1, selected: ['A'] },
      { questionId: 'q2', question: q2, selected: ['A'] },
    ];
    const out = buildPaperResult(s, marks, NOW);
    expect(out.correctCount).toBe(0);
    expect(out.attempts.map((a) => a.isCorrect)).toEqual([false, false]);
  });

  it('produces no attempt for questions missing from the pack', () => {
    const marks: PaperMark[] = [{ questionId: 'gone', question: null, selected: ['A'] }];
    const out = buildPaperResult(s, marks, NOW);
    expect(out.attempts).toHaveLength(0);
    expect(out.answeredCount).toBe(0);
  });

  it('is deterministic across re-marks: same sheet, same ids', () => {
    const marks: PaperMark[] = [{ questionId: 'q1', question: q1, selected: ['B'] }];
    const first = buildPaperResult(s, marks, NOW);
    const again = buildPaperResult(s, marks, NOW + 99_999);
    expect(again.attempts[0].id).toBe(first.attempts[0].id);
    expect(again.session.id).toBe(first.session.id);
  });
});

describe('answerBoxLabel', () => {
  it('asks for one letter, or all of them for multi-answer', () => {
    expect(answerBoxLabel(question('q1'))).toBe('Write the letter');
    expect(
      answerBoxLabel(question('q2', { correctKey: undefined, correctKeys: ['A', 'B'] })),
    ).toBe('Write ALL the correct letters');
  });
});

describe('sheet persistence', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      dispatchEvent: () => true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves newest-first, upserts by id, deletes, and stamps marked', () => {
    savePaperSheet(sheet({ id: 'a', code: 'P-AAAA' }));
    savePaperSheet(sheet({ id: 'b', code: 'P-CCCC' }));
    expect(loadPaperSheets().map((s) => s.id)).toEqual(['b', 'a']);

    savePaperSheet(sheet({ id: 'a', code: 'P-DDDD' }));
    expect(loadPaperSheets().map((s) => s.code)).toEqual(['P-DDDD', 'P-CCCC']);

    recordSheetMarked('b', 42);
    expect(getPaperSheet('b')?.markedAt).toBe(42);
    recordSheetMarked('unknown', 42); // no-op, no throw

    deletePaperSheet('a');
    expect(loadPaperSheets().map((s) => s.id)).toEqual(['b']);
  });

  it('caps stored sheets at MAX_STORED_SHEETS', () => {
    for (let i = 0; i < MAX_STORED_SHEETS + 5; i++) {
      savePaperSheet(sheet({ id: `s${i}` }));
    }
    const ids = loadPaperSheets().map((s) => s.id);
    expect(ids).toHaveLength(MAX_STORED_SHEETS);
    expect(ids[0]).toBe(`s${MAX_STORED_SHEETS + 4}`); // newest kept
  });

  it('survives corrupt storage', () => {
    savePaperSheet(sheet({ id: 'a' }));
    const key = [...store.keys()].find((k) => k.includes('paperSheets'))!;
    store.set(key, '{not json');
    expect(loadPaperSheets()).toEqual([]);
    store.set(key, '"a string, not an array"');
    expect(loadPaperSheets()).toEqual([]);
  });
});
