/**
 * Engine record types — what the storage / sync / mistakes layers
 * operate on. Question shapes live in src/pack/data.ts (they come from
 * the active pack); the engine only sees the denormalised fields it
 * needs on each attempt.
 */

export interface Attempt {
  id: string; // crypto.randomUUID() at write time
  sessionId: string;
  questionId: string;
  answeredAt: number; // unix ms
  selectedAnswer: string;
  isCorrect: boolean;
  timeTakenSeconds: number;
  // Denormalised for offline querying without the question bank.
  // `subject` carries the pack category key; `topic` is the rescue key
  // for the mistakes engine (quizmill packs use the question id — a
  // mistake is rescued only by re-answering that question correctly).
  subject: string;
  topic: string;
  difficulty: number;
}

export interface Session {
  id: string; // crypto.randomUUID()
  /** Pack category key (see Attempt.subject). */
  subject: string;
  startedAt: number;
  endedAt: number | null;
  questionCount: number;
  correctCount: number;
  /** Optional. Defaults to 'practice' when missing (older records). */
  mode?: 'practice' | 'review';
}
