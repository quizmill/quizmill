/**
 * Thin wrappers over the Web Speech API for Drive Mode. All the logic
 * that can be pure lives in src/lib/voice.ts; this module is the
 * browser seam, and DriveRunner tests replace it wholesale with
 * vi.mock. Support notes (2026):
 *
 * - speechSynthesis (TTS): everywhere, including installed PWAs.
 * - SpeechRecognition (STT): Chrome/Edge, and Safari iOS 14.5+ in a
 *   browser TAB only — feature-detectable but dead inside an installed
 *   (standalone) PWA, and it needs the network (Apple/Google servers).
 *   DriveRunner falls back to tap-to-answer when it's missing.
 */

// lib.dom has no SpeechRecognition types (it's still prefixed in
// WebKit); the minimal shape we use, declared locally.
interface RecognitionResultLike {
  readonly length: number;
  [index: number]: { transcript: string };
}
interface RecognitionEventLike {
  results: { 0: RecognitionResultLike };
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function sttSupported(): boolean {
  return recognitionCtor() !== null;
}

// Monotonic token so a newer speak()/cancelSpeech() invalidates the
// utterance chain of an older one (the chain checks it between chunks).
let speakToken = 0;

/** Stop any in-flight speech. The interrupted speak() resolves false. */
export function cancelSpeech(): void {
  speakToken++;
  if (ttsSupported()) window.speechSynthesis.cancel();
}

/**
 * Speak text aloud; resolves true when it finished, false when it was
 * cancelled (or errored). Spoken sentence-by-sentence — Chrome kills
 * single utterances longer than ~15s, and chunking also makes
 * cancellation snappy.
 */
export function speak(text: string, rate = 1): Promise<boolean> {
  if (!ttsSupported()) return Promise.resolve(true);
  cancelSpeech();
  const token = speakToken;
  const chunks = splitSentences(text);
  return new Promise((resolve) => {
    const next = (i: number) => {
      if (token !== speakToken) return resolve(false);
      if (i >= chunks.length) return resolve(true);
      const u = new SpeechSynthesisUtterance(chunks[i]);
      u.rate = rate;
      u.onend = () => next(i + 1);
      // Cancellation surfaces as an error event in most browsers.
      u.onerror = () => resolve(false);
      window.speechSynthesis.speak(u);
    };
    next(0);
  });
}

/**
 * iOS Safari only allows speech that originates from a user gesture;
 * one empty utterance inside the Start tap unlocks the session.
 */
export function warmUpTts(): void {
  if (!ttsSupported()) return;
  const u = new SpeechSynthesisUtterance('');
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

let currentRecognition: RecognitionLike | null = null;

/** Abort an in-flight listenOnce(); it resolves []. */
export function cancelListening(): void {
  try {
    currentRecognition?.abort();
  } catch {
    /* already stopped */
  }
  currentRecognition = null;
}

export interface ListenResult {
  /** Alternative transcripts, best first; empty when nothing was heard. */
  transcripts: string[];
  /** True when recognition itself failed (mic denied, no audio device,
   *  service unreachable) rather than the user staying quiet — callers
   *  use this to give up on voice instead of re-prompting forever. */
  error: boolean;
}

/**
 * Listen for one utterance and resolve with the recogniser's alternative
 * transcripts, best first. Silence/timeout resolve {transcripts: [],
 * error: false}; a recognition failure resolves with error: true.
 */
export function listenOnce(
  opts: { lang?: string; timeoutMs?: number } = {},
): Promise<ListenResult> {
  const Ctor = recognitionCtor();
  if (!Ctor) return Promise.resolve({ transcripts: [], error: true });
  return new Promise((resolve) => {
    const rec = new Ctor();
    currentRecognition = rec;
    rec.lang =
      opts.lang ??
      (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    rec.interimResults = false;
    rec.maxAlternatives = 4;

    let settled = false;
    const finish = (transcripts: string[], error = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (currentRecognition === rec) currentRecognition = null;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
      resolve({ transcripts, error });
    };
    const timer = setTimeout(() => finish([]), opts.timeoutMs ?? 8_000);

    rec.onresult = (e) => {
      const res = e.results[0];
      const alts: string[] = [];
      for (let i = 0; i < res.length; i++) alts.push(res[i].transcript);
      finish(alts);
    };
    // "no-speech" is Chrome's way of timing out an utterance — that's
    // silence, not a broken recogniser.
    rec.onerror = (e?: { error?: string }) =>
      finish([], e?.error !== 'no-speech' && e?.error !== 'aborted');
    rec.onend = () => finish([]);
    try {
      rec.start();
    } catch {
      finish([], true);
    }
  });
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
