'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Car,
  Check,
  Home,
  Mic,
  MicOff,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Volume2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import {
  useRecordAttempt,
  useStartSession,
  useEndSession,
  useStorageData,
} from '@/lib/useStorage';
import {
  loadAchievements,
  loadAttempts,
  loadLevelFilter,
  loadSessions,
  recordEarnedAchievements,
} from '@/lib/storage';
import { newlyEarnedAchievements } from '@/pack/achievements-engine';
import {
  cancelListening,
  cancelSpeech,
  listenOnce,
  speak,
  sttSupported,
  warmUpTts,
} from '@/lib/speech';
import {
  matchAnswer,
  matchCommand,
  repromptForOptions,
  speechForFeedback,
  speechForQuestion,
  speechForResults,
} from '@/lib/voice';
import {
  isMultiAnswer,
  packQuestions,
  packScenarios,
  type OptionKey,
  type PackQuestion,
} from '@/pack/data';
import {
  advanceAfterAnswer,
  buildAttempt,
  buildSessionEnd,
  buildSessionStart,
  filterByLevel,
  isLastQuestion,
  moveToNext,
  pickSessionFromBank,
  scoreSummary,
  type RunnerState,
} from './runner';

/**
 * Drive Mode: the practice loop as a hands-free voice conversation for
 * the car. Questions are read aloud (speechSynthesis); answers come in
 * by voice (SpeechRecognition, where available) or by tapping the big
 * option tiles. Sessions mix all categories and record through the
 * same storage as the normal runner — attempts carry each question's
 * real category, the session carries the 'drive' pseudo-subject (mode
 * stays 'practice': the Supabase mirror constrains mode, and a drive
 * round IS practice).
 *
 * The screen is deliberately dark, huge, and low-information: it's a
 * status display, not a reading surface. Anything visual is for the
 * passenger or the parked driver.
 */

type Phase =
  | 'intro' // safety/start screen — TTS needs a user gesture anyway
  | 'asking' // reading the question aloud
  | 'listening' // waiting for a spoken (or tapped) answer
  | 'feedback' // reading the verdict + explanation, then auto-advance
  | 'paused'
  | 'done'
  | 'empty'; // nothing voiceable to practise

/** Session pseudo-subject; attempts keep their real category key. */
const DRIVE_SUBJECT = 'drive';
/** Consecutive silent listens before auto-pausing (driver's gone quiet). */
const MAX_SILENT_ROUNDS = 4;
/** Reprompts before we stop nagging and just keep listening. */
const MAX_REPROMPTS = 2;

export function DriveRunner() {
  const { attempts } = useStorageData();
  const recordAttempt = useRecordAttempt();
  const startSession = useStartSession();
  const endSession = useEndSession();

  const [phase, setPhase] = useState<Phase>('intro');
  const [state, setState] = useState<RunnerState | null>(null);
  const [selected, setSelected] = useState<OptionKey | null>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  // STT support is read after mount: the server render must not depend
  // on browser APIs, and Safari-standalone quirks make it dynamic.
  const [stt, setStt] = useState(false);
  useEffect(() => setStt(sttSupported()), []);
  // Recognition can exist but not work (mic permission denied, no audio
  // device, speech service unreachable). After repeated hard errors the
  // session degrades to tap-to-answer instead of nagging.
  const [voiceBroken, setVoiceBroken] = useState(false);
  const voiceOn = stt && !voiceBroken;

  // Only questions that work with no screen: text prompt, text options,
  // and a single spoken answer. Multi-answer ("select all that apply")
  // can't be voiced hands-free — excluded like image questions are.
  const bank = useMemo(
    () =>
      packQuestions.filter(
        (q) => !q.image && q.options.every((o) => !o.image) && !isMultiAnswer(q),
      ),
    [],
  );

  const current: PackQuestion | null =
    state !== null ? state.questions[state.currentIndex] : null;

  function silentAchievementCheck() {
    // Same evaluation the visual runners do via useAchievementUnlock,
    // minus the Celebration overlay — no confetti at 60 mph.
    const earned = new Set(loadAchievements().map((e) => e.id));
    const fresh = newlyEarnedAchievements(loadSessions(), loadAttempts(), earned);
    if (fresh.length > 0) recordEarnedAchievements(fresh);
  }

  function handleStart() {
    warmUpTts(); // unlock TTS inside the tap gesture (iOS)
    const voiceBank = filterByLevel(bank, loadLevelFilter());
    const historical = new Set(attempts.map((a) => a.questionId));
    const picked = pickSessionFromBank(voiceBank, historical);
    if (picked === null) {
      setPhase('empty');
      return;
    }
    const initial: RunnerState = {
      sessionId: crypto.randomUUID(),
      questions: picked,
      currentIndex: 0,
      correctCount: 0,
      startedAt: Date.now(),
    };
    startSession(buildSessionStart(initial, DRIVE_SUBJECT));
    setState(initial);
    setSelected(null);
    setLastHeard(null);
    setPhase('asking');
  }

  function handleAnswer(key: OptionKey) {
    if (!state || !current) return;
    if (phase !== 'listening' && phase !== 'asking') return;
    cancelSpeech();
    cancelListening();
    const attempt = buildAttempt({
      state,
      question: current,
      selected: [key],
      categoryKey: current.categoryKey,
      now: Date.now(),
      attemptId: crypto.randomUUID(),
    });
    recordAttempt(attempt);
    silentAchievementCheck();
    setSelected(key);
    setState(advanceAfterAnswer(state, attempt.isCorrect));
    setPhase('feedback');
  }

  function advance(fromState: RunnerState) {
    if (isLastQuestion(fromState)) {
      endSession(buildSessionEnd(fromState, DRIVE_SUBJECT, Date.now()));
      silentAchievementCheck();
      setPhase('done');
      return;
    }
    setState(moveToNext(fromState));
    setSelected(null);
    setLastHeard(null);
    setPhase('asking');
  }

  function doPause() {
    cancelSpeech();
    cancelListening();
    setPhase('paused');
  }

  function doResume() {
    // Paused mid-feedback resumes the feedback (selected is still set);
    // otherwise re-read the current question from the top.
    setPhase(selected !== null ? 'feedback' : 'asking');
  }

  // ── Voice loop effects ──────────────────────────────────────────────

  // handleAnswer closes over phase/state; the listening loop lives
  // across renders, so it calls through a ref to get the fresh one.
  const handleAnswerRef = useRef(handleAnswer);
  handleAnswerRef.current = handleAnswer;

  // asking: read the question, then open the answer window.
  useEffect(() => {
    if (phase !== 'asking' || !state) return;
    let cancelled = false;
    const q = state.questions[state.currentIndex];
    const stem = q.scenarioId
      ? packScenarios.find((s) => s.id === q.scenarioId)?.stem
      : undefined;
    speak(
      speechForQuestion(q, state.currentIndex, state.questions.length, stem),
    ).then((completed) => {
      if (!cancelled && completed) setPhase('listening');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, state?.currentIndex]);

  // listening: recognition rounds until an answer, a command, or enough
  // silence to auto-pause. Tap answers interrupt via handleAnswer.
  useEffect(() => {
    if (phase !== 'listening' || !state || !voiceOn) return;
    let cancelled = false;
    const q = state.questions[state.currentIndex];
    (async () => {
      let silentRounds = 0;
      let reprompts = 0;
      let errorRounds = 0;
      while (!cancelled) {
        const { transcripts, error } = await listenOnce();
        if (cancelled) return;
        if (error) {
          errorRounds++;
          if (errorRounds >= 2) {
            await speak(
              'Voice input is not working here, so tap your answer instead.',
            );
            if (!cancelled) setVoiceBroken(true);
            return;
          }
          continue;
        }
        errorRounds = 0;
        setLastHeard(transcripts[0] ?? null);

        const cmd = transcripts.map(matchCommand).find((c) => c !== null);
        if (cmd === 'repeat') {
          setPhase('asking');
          return;
        }
        if (cmd === 'pause') {
          doPause();
          return;
        }
        const key = transcripts
          .map((t) => matchAnswer(t, q.options))
          .find((k) => k !== null);
        if (key) {
          handleAnswerRef.current(key);
          return;
        }

        if (transcripts.length === 0) {
          silentRounds++;
          if (silentRounds >= MAX_SILENT_ROUNDS) {
            await speak('Pausing here. Tap resume when you are ready.');
            if (!cancelled) doPause();
            return;
          }
          continue;
        }
        // Heard something that matched nothing — help, but don't nag.
        silentRounds = 0;
        if (reprompts < MAX_REPROMPTS) {
          reprompts++;
          await speak(repromptForOptions(q.options));
          if (cancelled) return;
        }
      }
    })();
    return () => {
      cancelled = true;
      cancelListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, state?.currentIndex, voiceOn]);

  // feedback: read verdict + explanation, then auto-advance. A pause
  // press cancels the speech (completed=false) and keeps us here.
  useEffect(() => {
    if (phase !== 'feedback' || !state || selected === null) return;
    let cancelled = false;
    const q = state.questions[state.currentIndex];
    const snapshot = state;
    speak(speechForFeedback(q, selected)).then((completed) => {
      if (!cancelled && completed) advance(snapshot);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // done: read the score once.
  useEffect(() => {
    if (phase !== 'done' || !state) return;
    const { correct, total } = scoreSummary(state);
    speak(speechForResults(correct, total));
    return () => cancelSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Keep the screen awake during a session — the whole point is not
  // touching the phone.
  const sessionActive =
    phase !== 'intro' && phase !== 'done' && phase !== 'empty';
  useEffect(() => {
    if (!sessionActive || typeof navigator === 'undefined') return;
    type WakeLockSentinel = { release(): Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const l = await nav.wakeLock!.request('screen');
        if (cancelled) await l.release();
        else lock = l;
      } catch {
        /* denied (low battery etc.) — nothing to do */
      }
    };
    acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [sessionActive]);

  // ── Screens ─────────────────────────────────────────────────────────

  if (phase === 'intro' || phase === 'empty') {
    return (
      <main className="flex flex-col gap-5">
        <DrivePanel>
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-500/20 text-brand-300">
              <Car className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Drive mode</h1>
              <p className="mt-1 text-ink-300">
                A hands-free, voice-only quiz for the road.
              </p>
            </div>
          </div>

          {phase === 'empty' ? (
            <div className="rounded-2xl border border-warn-500/40 bg-warn-500/10 p-4 text-sm text-warn-100">
              Nothing to practise out loud — this pack&apos;s questions rely
              on images, which can&apos;t be voiced.
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-3 text-[15px] text-ink-200">
                <IntroItem icon={<Volume2 className="h-5 w-5" />}>
                  Questions and answers are read aloud through your car&apos;s
                  speakers.
                </IntroItem>
                <IntroItem
                  icon={
                    stt ? (
                      <Mic className="h-5 w-5" />
                    ) : (
                      <MicOff className="h-5 w-5" />
                    )
                  }
                >
                  {stt ? (
                    <>
                      Answer by voice — say{' '}
                      <strong className="text-white">A, B, C, or D</strong>, or
                      say <strong className="text-white">repeat</strong> or{' '}
                      <strong className="text-white">pause</strong>.
                    </>
                  ) : (
                    <>
                      Voice answers aren&apos;t available in this browser, so
                      answering is by tap — best with a passenger. On iPhone,
                      open this app in a Safari tab (not the installed icon)
                      to get voice input.
                    </>
                  )}
                </IntroItem>
                <IntroItem icon={<Check className="h-5 w-5" />}>
                  Rounds count toward your stats, streak, and stickers — same
                  as regular practice.
                </IntroItem>
              </ul>
              <p className="rounded-2xl border border-ink-600 bg-ink-800 p-4 text-sm text-ink-300">
                <strong className="text-ink-100">Eyes on the road.</strong>{' '}
                Start before you set off, keep the phone docked, and let the
                voice do the work. This screen is for passengers.
              </p>
              <Button size="lg" block onClick={handleStart}>
                <Play className="h-4 w-4" />
                Start driving session
              </Button>
            </>
          )}
          <Link
            href="/"
            className="tap-feedback mx-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-ink-400 hover:bg-ink-800 hover:text-ink-200"
          >
            <Home className="h-4 w-4" />
            Back to home
          </Link>
        </DrivePanel>
      </main>
    );
  }

  if (phase === 'done' && state) {
    const { correct, total, pct } = scoreSummary(state);
    return (
      <main className="flex flex-col gap-5">
        <DrivePanel>
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Drive session complete
            </div>
            <div className="text-6xl font-bold">
              {correct}/{total}
            </div>
            <div className="text-lg text-ink-300">{pct}% correct</div>
          </div>
          <Button size="lg" block onClick={handleStart}>
            <RefreshCw className="h-4 w-4" />
            Another round
          </Button>
          <Link href="/" className="block">
            <Button size="lg" variant="secondary" block>
              <Home className="h-4 w-4" />
              Back to home
            </Button>
          </Link>
        </DrivePanel>
      </main>
    );
  }

  if (!state || !current) return null;

  const showFeedback = phase === 'feedback';
  const isCorrect = showFeedback && selected === current.correctKey;

  return (
    <main className="flex flex-col gap-5">
      <DrivePanel>
        <header className="flex items-center justify-between text-sm text-ink-400">
          <Link
            href="/"
            className="tap-feedback rounded-full px-2 py-1 font-medium hover:bg-ink-800 hover:text-ink-200"
          >
            End
          </Link>
          <span className="font-semibold text-ink-200">
            {state.currentIndex + 1} / {state.questions.length}
          </span>
          <span>
            {state.correctCount} correct
          </span>
        </header>

        <DriveStatus
          phase={phase}
          stt={voiceOn}
          lastHeard={lastHeard}
          isCorrect={isCorrect}
        />

        <div className="text-question font-semibold leading-snug text-white">
          {current.prompt}
        </div>

        <div className="flex flex-col gap-2" data-testid="drive-options">
          {current.options.map((opt) => {
            const isThis = selected === opt.key;
            const isAnswer = opt.key === current.correctKey;
            return (
              <button
                key={opt.key}
                type="button"
                disabled={showFeedback || phase === 'paused'}
                onClick={() => handleAnswer(opt.key)}
                className={cn(
                  'tap-feedback flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition disabled:cursor-default',
                  showFeedback && isAnswer
                    ? 'border-success-500 bg-success-500/20 text-success-100'
                    : showFeedback && isThis
                      ? 'border-warn-500 bg-warn-500/20 text-warn-100'
                      : 'border-ink-600 bg-ink-800 text-ink-100 hover:border-ink-400',
                )}
              >
                <span
                  className={cn(
                    'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-lg font-bold',
                    showFeedback && isAnswer
                      ? 'bg-success-500 text-white'
                      : showFeedback && isThis
                        ? 'bg-warn-500 text-white'
                        : 'bg-ink-600 text-white',
                  )}
                >
                  {opt.key}
                </span>
                <span className="flex-1 text-[15px] leading-snug">
                  {opt.text}
                </span>
              </button>
            );
          })}
        </div>

        {showFeedback ? (
          <div className="rounded-2xl border border-ink-600 bg-ink-800 p-4 text-sm leading-relaxed text-ink-200">
            {current.explanation}
          </div>
        ) : null}

        <div className="mt-auto flex items-center justify-center gap-3">
          <DriveControl
            label="Repeat"
            onClick={() => {
              if (phase === 'asking' || phase === 'listening') {
                cancelSpeech();
                cancelListening();
                setPhase('asking');
              }
            }}
          >
            <RotateCcw className="h-6 w-6" />
          </DriveControl>
          {phase === 'paused' ? (
            <DriveControl label="Resume" primary onClick={doResume}>
              <Play className="h-7 w-7" />
            </DriveControl>
          ) : (
            <DriveControl label="Pause" primary onClick={doPause}>
              <Pause className="h-7 w-7" />
            </DriveControl>
          )}
        </div>
      </DrivePanel>
    </main>
  );
}

function DrivePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[82dvh] flex-col gap-5 rounded-3xl bg-ink-900 p-5 text-white shadow-lg">
      {children}
    </div>
  );
}

function IntroItem({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-ink-800 text-brand-300">
        {icon}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function DriveStatus({
  phase,
  stt,
  lastHeard,
  isCorrect,
}: {
  phase: Phase;
  stt: boolean;
  lastHeard: string | null;
  isCorrect: boolean;
}) {
  let icon: React.ReactNode;
  let label: string;
  let tone = 'bg-ink-800 text-brand-300';
  if (phase === 'asking') {
    icon = <Volume2 className="h-8 w-8 animate-pulse" />;
    label = 'Reading question…';
  } else if (phase === 'listening') {
    icon = stt ? <Mic className="h-8 w-8" /> : <MicOff className="h-8 w-8" />;
    label = stt ? 'Listening…' : 'Tap an answer';
    tone = stt ? 'bg-brand-500/20 text-brand-300' : tone;
  } else if (phase === 'paused') {
    icon = <Pause className="h-8 w-8" />;
    label = 'Paused';
  } else if (isCorrect) {
    icon = <Check className="h-8 w-8" />;
    label = 'Correct!';
    tone = 'bg-success-500/20 text-success-100';
  } else {
    icon = <X className="h-8 w-8" />;
    label = 'Not quite';
    tone = 'bg-warn-500/20 text-warn-100';
  }
  return (
    <div
      className="flex flex-col items-center gap-2 py-2 text-center"
      data-testid="drive-status"
    >
      <div className="relative">
        {phase === 'listening' && stt ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-brand-500/30" />
        ) : null}
        <div
          className={cn(
            'relative flex h-20 w-20 items-center justify-center rounded-full',
            tone,
          )}
        >
          {icon}
        </div>
      </div>
      <div className="text-sm font-semibold text-ink-200">{label}</div>
      {phase === 'listening' && lastHeard ? (
        <div className="rounded-full bg-ink-800 px-3 py-1 text-xs text-ink-400">
          Heard: “{lastHeard}”
        </div>
      ) : null}
    </div>
  );
}

function DriveControl({
  label,
  primary,
  onClick,
  children,
}: {
  label: string;
  primary?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'tap-feedback flex flex-col items-center gap-1 rounded-2xl px-6 py-3',
        primary
          ? 'bg-brand-500 text-white hover:bg-brand-400'
          : 'bg-ink-800 text-ink-200 hover:bg-ink-700',
      )}
    >
      {children}
      <span className="text-xs font-semibold">{label}</span>
    </button>
  );
}
