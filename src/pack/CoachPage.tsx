'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  GraduationCap,
} from 'lucide-react';
import { PackChip } from '@/components/PackChip';
import { McqMarkdown } from '@/components/McqMarkdown';
import { SourceRef } from '@/components/SourceRef';
import { Button } from '@/components/ui/Button';
import { useStorageData } from '@/lib/useStorage';
import { cn } from '@/lib/cn';
import {
  formatSpan,
  groupSessionsByDay,
  selectedKeys,
  sessionReplay,
  SESSION_MODE_LABEL,
  type CoachDay,
  type CoachSession,
  type ReplayStep,
} from '@/lib/coachSessions';
import {
  correctKeysOf,
  isMultiAnswer,
  packQuestions,
  packScenarios,
  PACK_CATEGORY_LABEL,
  PACK_CONCEPT_BY_ID,
  type OptionKey,
  type PackQuestion,
} from '@/pack/data';
import { ConceptCard } from '@/pack/ConceptCard';
import { OptionButtons } from '@/pack/OptionButtons';
import { PackImage } from '@/pack/PackImage';
import { QuestionMeta } from '@/pack/QuestionMeta';
import { gradeSelection, nextSelection, formatKeyList } from '@/pack/runner';

const HASH_PREFIX = '#session=';

function sessionIdFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash;
  return h.startsWith(HASH_PREFIX) ? decodeURIComponent(h.slice(HASH_PREFIX.length)) : null;
}

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}

/**
 * Coach mode — replay any past session with the learner, question by
 * question. Two screens on one static route: the day/session list, and
 * one session's replay (deep-linked as `#session=<id>` so the browser's
 * back button returns to the list).
 *
 * Deliberately records NOTHING: no attempts, sessions, votes or notes.
 * The parent can tap options to re-answer together, and reveal each
 * answer (or all at once), but the learner's history is read-only here.
 */
export function CoachPage() {
  const { sessions, attempts } = useStorageData();
  const [mounted, setMounted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setSelectedId(sessionIdFromHash());
    const onHash = () => setSelectedId(sessionIdFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const days = useMemo(() => groupSessionsByDay(sessions, attempts), [sessions, attempts]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    for (const day of days) {
      const found = day.sessions.find((s) => s.session.id === selectedId);
      if (found) return found;
    }
    return null;
  }, [days, selectedId]);

  function openSession(id: string) {
    window.location.hash = `${HASH_PREFIX}${encodeURIComponent(id)}`;
    setSelectedId(id);
  }

  function closeSession() {
    // Replace the hash without a scroll jump; back-button history stays sane.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setSelectedId(null);
  }

  if (!mounted) {
    return (
      <main className="flex flex-col gap-5">
        <BackLink href="/" label="Home" />
        <div className="rounded-2xl border border-ink-200 bg-surface p-6 text-center text-ink-500 shadow-sm">
          Loading…
        </div>
      </main>
    );
  }

  if (selected) {
    return <SessionReplay coachSession={selected} onBack={closeSession} />;
  }

  return (
    <main className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <BackLink href="/" label="Home" />
      </header>

      <div>
        <PackChip className="mb-2" />
        <h1 className="flex items-center gap-2 text-3xl font-bold text-ink-900">
          <GraduationCap className="h-7 w-7 text-brand-600" />
          Coach
        </h1>
        <p className="mt-1 text-ink-500">
          Go back through any session together. Pick a day, then a session, to
          see every question, what was answered, and the explanation — answers
          stay hidden until you reveal them. Nothing here is recorded.
        </p>
      </div>

      {days.length === 0 ? (
        <div
          data-testid="coach-empty"
          className="rounded-2xl border border-ink-200 bg-surface p-6 text-center text-ink-600 shadow-sm"
        >
          No sessions yet. Once some practice has happened (or synced to this
          device), the days show up here.
        </div>
      ) : (
        <ol className="flex flex-col gap-5">
          {days.map((day) => (
            <DayCard key={day.dayKey} day={day} onOpen={openSession} />
          ))}
        </ol>
      )}
    </main>
  );
}

function DayCard({ day, onOpen }: { day: CoachDay; onOpen: (id: string) => void }) {
  return (
    <li data-testid="coach-day" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-base font-semibold text-ink-900">{DAY_FORMAT.format(day.date)}</h2>
        <span className="text-sm tabular-nums text-ink-500">
          {day.correct}/{day.answered} right
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {day.sessions.map((cs) => (
          <SessionRow key={cs.session.id} coachSession={cs} onOpen={onOpen} />
        ))}
      </ol>
    </li>
  );
}

function SessionRow({
  coachSession: cs,
  onOpen,
}: {
  coachSession: CoachSession;
  onOpen: (id: string) => void;
}) {
  const subjects = cs.subjects
    .map((k) => PACK_CATEGORY_LABEL[k] ?? k)
    .join(', ');
  return (
    <li>
      <button
        type="button"
        data-testid="coach-session"
        onClick={() => onOpen(cs.session.id)}
        className="tap-feedback flex w-full items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-surface p-4 text-left shadow-sm hover:bg-ink-50 dark:hover:bg-ink-100"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-base font-semibold text-ink-900">
              {SESSION_MODE_LABEL[cs.mode]}
            </span>
            {cs.abandoned ? (
              <span className="rounded-full bg-warn-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warn-700">
                not finished
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-sm text-ink-600">{subjects}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-ink-500">
            <span>{TIME_FORMAT.format(new Date(cs.session.startedAt))}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatSpan(cs.spanSeconds)}
            </span>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-sm font-bold tabular-nums',
              cs.correct === cs.answered
                ? 'bg-success-100 text-success-700'
                : 'bg-ink-100 text-ink-800',
            )}
          >
            {cs.correct}/{cs.answered}
          </span>
          <ChevronRight className="h-5 w-5 text-ink-400" />
        </div>
      </button>
    </li>
  );
}

function SessionReplay({
  coachSession: cs,
  onBack,
}: {
  coachSession: CoachSession;
  onBack: () => void;
}) {
  const questionById = useMemo(
    () => new Map(packQuestions.map((q) => [q.id, q])),
    [],
  );
  const replay = useMemo(
    () => sessionReplay(cs.attempts, questionById),
    [cs.attempts, questionById],
  );
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const allRevealed = replay.steps.length > 0 && revealed.size === replay.steps.length;

  function toggle(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setRevealed(allRevealed ? new Set() : new Set(replay.steps.map((s) => s.attempt.id)));
  }

  const started = new Date(cs.session.startedAt);

  return (
    <main className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          data-testid="coach-back"
          className="tap-feedback inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Sessions
        </button>
        <Button
          size="sm"
          variant="secondary"
          data-testid="coach-toggle-all"
          aria-pressed={allRevealed}
          onClick={toggleAll}
        >
          {allRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {allRevealed ? 'Hide all answers' : 'Show all answers'}
        </Button>
      </header>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          {DAY_FORMAT.format(started)} · {TIME_FORMAT.format(started)}
        </div>
        <h1 className="mt-1 text-3xl font-bold text-ink-900">{SESSION_MODE_LABEL[cs.mode]}</h1>
        <p className="mt-1 text-ink-500">
          <span className="font-semibold text-ink-800">
            {cs.correct}/{cs.answered}
          </span>{' '}
          right in {formatSpan(cs.spanSeconds)}
          {cs.abandoned ? ' — the round was not finished' : ''}.
          Tap options to answer again together; nothing is saved.
        </p>
      </div>

      {replay.unknownQuestions > 0 ? (
        <p className="rounded-xl border border-ink-200 bg-ink-50/60 px-4 py-3 text-sm text-ink-600">
          {replay.unknownQuestions}{' '}
          {replay.unknownQuestions === 1 ? 'answer is' : 'answers are'} to
          questions that are no longer in this pack, so they are not shown.
        </p>
      ) : null}

      <ol className="flex flex-col gap-5">
        {replay.steps.map((step) => (
          <ReplayCard
            key={step.attempt.id}
            step={step}
            total={replay.steps.length}
            revealed={revealed.has(step.attempt.id)}
            onToggle={() => toggle(step.attempt.id)}
          />
        ))}
      </ol>
    </main>
  );
}

function ReplayCard({
  step,
  total,
  revealed,
  onToggle,
}: {
  step: ReplayStep<PackQuestion>;
  total: number;
  revealed: boolean;
  onToggle: () => void;
}) {
  const { attempt, question } = step;
  const multi = isMultiAnswer(question);
  const answerKeys = correctKeysOf(question);
  const learnerKeys = selectedKeys(attempt) as OptionKey[];
  // The parent's own (ephemeral) pick while the answer is hidden.
  const [pick, setPick] = useState<OptionKey[]>([]);
  const scenario = question.scenarioId
    ? packScenarios.find((s) => s.id === question.scenarioId)
    : undefined;
  const concept = question.conceptId ? PACK_CONCEPT_BY_ID[question.conceptId] : undefined;
  const pickGraded = pick.length > 0 ? gradeSelection(question, pick) : null;

  return (
    <li
      data-testid="coach-step"
      data-revealed={revealed ? '1' : '0'}
      className="flex flex-col gap-3 rounded-2xl border border-ink-200 bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <QuestionMeta question={question} />
        {scenario ? (
          <span className="rounded-full border border-ink-300 bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-700">
            {scenario.title}
          </span>
        ) : null}
        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-600">
          Q {step.index} / {total}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-500">
          <Clock className="h-3 w-3" />
          {formatSpan(attempt.timeTakenSeconds)}
        </span>
      </div>

      {scenario?.stem ? (
        <details className="rounded-xl border border-ink-200 bg-ink-50/60">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-ink-800">
            Read the passage
          </summary>
          <div className="max-h-80 overflow-y-auto border-t border-ink-200 px-4 py-3 text-[15px] leading-relaxed text-ink-800">
            <McqMarkdown text={scenario.stem} />
          </div>
        </details>
      ) : null}

      <div className="text-[15px] leading-relaxed text-ink-900">
        <McqMarkdown text={question.prompt} />
      </div>

      {question.image ? (
        <div className="flex justify-center rounded-xl border border-ink-200 bg-surface p-3">
          <PackImage src={question.image} alt="" className="max-h-72 w-auto object-contain" />
        </div>
      ) : null}

      <OptionButtons
        options={question.options}
        selected={revealed ? learnerKeys : pick}
        stage={revealed ? 'feedback' : 'choosing'}
        correctKeys={answerKeys}
        multi={multi}
        onSelect={(key) => {
          if (revealed) return;
          setPick((prev) => nextSelection(prev, key, multi));
        }}
      />

      <div className="flex items-center justify-between gap-3">
        {!revealed && pickGraded !== null ? (
          <span className="text-sm text-ink-500">
            Picked {formatKeyList(pick)} — reveal to check.
          </span>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          variant={revealed ? 'secondary' : 'primary'}
          data-testid="coach-reveal"
          aria-expanded={revealed}
          onClick={onToggle}
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {revealed ? 'Hide answer' : 'Show answer'}
        </Button>
      </div>

      {revealed ? (
        <div
          data-testid="coach-answer"
          className={cn(
            'flex flex-col gap-3 rounded-xl border p-4',
            attempt.isCorrect
              ? 'border-success-500/30 bg-success-100/60'
              : 'border-warn-500/30 bg-warn-100/60',
          )}
        >
          <div
            className={cn(
              'text-base font-bold',
              attempt.isCorrect ? 'text-success-700' : 'text-warn-700',
            )}
          >
            {attempt.isCorrect ? 'Got it right' : 'Got it wrong'}
            <span className="font-medium text-ink-700">
              {' '}
              — answered {formatKeyList(learnerKeys)}
              {attempt.isCorrect ? '' : `, the answer is ${formatKeyList(answerKeys)}`}
              {attempt.firstSelected && attempt.firstSelected !== attempt.selectedAnswer
                ? `, first tapped ${attempt.firstSelected}`
                : ''}
              .
            </span>
          </div>
          {pickGraded !== null ? (
            <div className="text-sm text-ink-700">
              Just now you picked {formatKeyList(pick)} —{' '}
              {pickGraded ? 'correct.' : 'not right.'}
            </div>
          ) : null}
          <div className="text-[15px] leading-relaxed text-ink-800">
            <McqMarkdown text={question.explanation} />
          </div>
          {concept ? <ConceptCard concept={concept} defaultOpen={!attempt.isCorrect} /> : null}
          <SourceRef sourceRef={question.sourceRef} />
        </div>
      ) : null}
    </li>
  );
}
