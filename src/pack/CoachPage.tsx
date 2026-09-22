'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  GraduationCap,
  History,
} from 'lucide-react';
import { PackChip } from '@/components/PackChip';
import { McqMarkdown } from '@/components/McqMarkdown';
import { SourceRef } from '@/components/SourceRef';
import { Button } from '@/components/ui/Button';
import { useStorageData } from '@/lib/useStorage';
import { cn } from '@/lib/cn';
import type { Attempt } from '@/data/types';
import {
  dayReplay,
  formatSpan,
  groupSessionsByDay,
  priorAttempts,
  selectedKeys,
  sessionReplay,
  SESSION_MODE_LABEL,
  type CoachDay,
  type CoachSession,
  type Replay,
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

/** What the URL hash points at: one session, or a whole day. */
type Target = { kind: 'session'; id: string } | { kind: 'day'; dayKey: string };

function targetFromHash(): Target | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash;
  if (h.startsWith('#session=')) {
    return { kind: 'session', id: decodeURIComponent(h.slice('#session='.length)) };
  }
  if (h.startsWith('#day=')) {
    return { kind: 'day', dayKey: decodeURIComponent(h.slice('#day='.length)) };
  }
  return null;
}

function hashFor(t: Target): string {
  return t.kind === 'session'
    ? `#session=${encodeURIComponent(t.id)}`
    : `#day=${encodeURIComponent(t.dayKey)}`;
}

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
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
 * Coach mode — replay past practice with the learner, question by
 * question. Two screens on one static route: the day/session list, and a
 * replay of one session (`#session=<id>`) or of a whole day
 * (`#day=<YYYY-M-D>`), so the browser's back button returns to the list.
 *
 * Deliberately records NOTHING: no attempts, sessions, votes or notes.
 * The parent can tap options to re-answer together, and reveal each
 * answer (or all at once), but the learner's history is read-only here.
 */
export function CoachPage() {
  const { sessions, attempts } = useStorageData();
  const [mounted, setMounted] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    setMounted(true);
    setTarget(targetFromHash());
    const onHash = () => setTarget(targetFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const days = useMemo(() => groupSessionsByDay(sessions, attempts), [sessions, attempts]);
  const questionById = useMemo(
    () => new Map(packQuestions.map((q) => [q.id, q])),
    [],
  );

  function open(t: Target) {
    window.location.hash = hashFor(t);
    setTarget(t);
    // The list may be scrolled a long way down; the replay starts at its top.
    window.scrollTo(0, 0);
  }

  function close() {
    // Replace the hash (no history entry of its own); the browser's back
    // button also lands here via hashchange.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setTarget(null);
    window.scrollTo(0, 0);
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

  if (target?.kind === 'day') {
    const day = days.find((d) => d.dayKey === target.dayKey);
    if (day) {
      return (
        <ReplayView
          key={`day-${day.dayKey}`}
          eyebrow={`${day.sessions.length} ${day.sessions.length === 1 ? 'session' : 'sessions'}`}
          title={DAY_FORMAT.format(day.date)}
          replay={dayReplay(day, questionById)}
          sessionsById={new Map(day.sessions.map((s) => [s.session.id, s]))}
          allAttempts={attempts}
          onBack={close}
        />
      );
    }
  }

  if (target?.kind === 'session') {
    let found: CoachSession | undefined;
    for (const day of days) {
      found = day.sessions.find((s) => s.session.id === target.id);
      if (found) break;
    }
    if (found) {
      const started = new Date(found.session.startedAt);
      return (
        <ReplayView
          key={`session-${found.session.id}`}
          eyebrow={`${DAY_FORMAT.format(started)} · ${TIME_FORMAT.format(started)}`}
          title={SESSION_MODE_LABEL[found.mode]}
          replay={sessionReplay(found.attempts, questionById)}
          sessionsById={new Map([[found.session.id, found]])}
          allAttempts={attempts}
          abandoned={found.abandoned}
          onBack={close}
        />
      );
    }
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
          Pick a day or a session and go through it together. Answers stay
          hidden until you reveal them, and nothing is recorded.
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
        <ol className="flex flex-col gap-6">
          {days.map((day) => (
            <DayCard key={day.dayKey} day={day} onOpen={open} />
          ))}
        </ol>
      )}
    </main>
  );
}

function DayCard({ day, onOpen }: { day: CoachDay; onOpen: (t: Target) => void }) {
  const wrong = day.answered - day.correct;
  return (
    <li data-testid="coach-day" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-base font-semibold text-ink-900">{DAY_FORMAT.format(day.date)}</h2>
        <span className="text-sm tabular-nums text-ink-500">
          {day.correct}/{day.answered} right
        </span>
      </div>
      <button
        type="button"
        data-testid="coach-day-review"
        onClick={() => onOpen({ kind: 'day', dayKey: day.dayKey })}
        className="tap-feedback flex w-full items-center justify-between gap-3 rounded-2xl border border-brand-500/30 bg-brand-50 p-4 text-left shadow-sm"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-brand-700">
            <CalendarDays className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold text-ink-900">Review the whole day</div>
            <div className="text-sm text-ink-600">
              All {day.answered} answers in order
              {wrong > 0 ? ` — ${wrong} to go over` : ' — nothing missed'}.
            </div>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 flex-shrink-0 text-ink-400" />
      </button>
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
  onOpen: (t: Target) => void;
}) {
  const subjects = cs.subjects
    .map((k) => PACK_CATEGORY_LABEL[k] ?? k)
    .join(', ');
  return (
    <li>
      <button
        type="button"
        data-testid="coach-session"
        onClick={() => onOpen({ kind: 'session', id: cs.session.id })}
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

type Filter = 'all' | 'wrong';

/** One replay — a session's answers or a whole day's — with a mistakes
 *  filter and a reveal-all toggle. */
function ReplayView({
  eyebrow,
  title,
  replay,
  sessionsById,
  allAttempts,
  abandoned = false,
  onBack,
}: {
  eyebrow: string;
  title: string;
  replay: Replay<PackQuestion>;
  sessionsById: ReadonlyMap<string, CoachSession>;
  allAttempts: readonly Attempt[];
  abandoned?: boolean;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());

  const wrongCount = replay.answered - replay.correct;
  const steps = useMemo(
    () => (filter === 'wrong' ? replay.steps.filter((s) => !s.attempt.isCorrect) : replay.steps),
    [filter, replay.steps],
  );
  const allRevealed = steps.length > 0 && steps.every((s) => revealed.has(s.attempt.id));
  const showDividers = sessionsById.size > 1;

  function toggle(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setRevealed((prev) => {
      const next = new Set(prev);
      for (const s of steps) {
        if (allRevealed) next.delete(s.attempt.id);
        else next.add(s.attempt.id);
      }
      return next;
    });
  }

  return (
    <main className="flex flex-col gap-5">
      {/* Sticky: a day replay runs to dozens of cards, and reveal-all is
          the control you reach for halfway down. */}
      <header className="sticky top-0 z-10 -mx-1 flex items-center justify-between bg-ink-50/95 px-1 py-2 backdrop-blur">
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
          disabled={steps.length === 0}
        >
          {allRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {allRevealed ? 'Hide all answers' : 'Show all answers'}
        </Button>
      </header>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">{eyebrow}</div>
        <h1 className="mt-1 text-3xl font-bold text-ink-900">{title}</h1>
        <p className="mt-1 text-ink-500">
          <span className="font-semibold text-ink-800">
            {replay.correct}/{replay.answered}
          </span>{' '}
          right{abandoned ? ' — the round was not finished' : ''}. Tap options to
          answer again together; nothing is saved.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Which answers to show"
        className="grid grid-cols-2 gap-1 rounded-xl bg-ink-100 p-1"
      >
        {(
          [
            ['all', `All (${replay.answered})`],
            ['wrong', `Mistakes only (${wrongCount})`],
          ] as [Filter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={filter === value}
            data-testid={`coach-filter-${value}`}
            onClick={() => setFilter(value)}
            className={cn(
              'tap-feedback rounded-lg px-3 py-2 text-sm font-semibold',
              filter === value ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {replay.unknownQuestions > 0 ? (
        <p className="rounded-xl border border-ink-200 bg-ink-50/60 px-4 py-3 text-sm text-ink-600">
          {replay.unknownQuestions}{' '}
          {replay.unknownQuestions === 1 ? 'answer is' : 'answers are'} to
          questions that are no longer in this pack, so they are not shown.
        </p>
      ) : null}

      {steps.length === 0 ? (
        <div
          data-testid="coach-no-mistakes"
          className="rounded-2xl border border-success-500/30 bg-success-100/60 p-6 text-center text-success-700"
        >
          Nothing was missed — every answer was right.
        </div>
      ) : (
        <ol className="flex flex-col gap-5">
          {steps.map((step) => {
            const cs = sessionsById.get(step.attempt.sessionId);
            return (
              <ReplayCard
                key={step.attempt.id}
                step={step}
                total={replay.answered}
                divider={
                  showDividers && step.sessionStart && cs
                    ? `${TIME_FORMAT.format(new Date(cs.session.startedAt))} · ${SESSION_MODE_LABEL[cs.mode]} · ${cs.correct}/${cs.answered}`
                    : null
                }
                prior={priorAttempts(step.attempt, allAttempts)}
                revealed={revealed.has(step.attempt.id)}
                onToggle={() => toggle(step.attempt.id)}
              />
            );
          })}
        </ol>
      )}
    </main>
  );
}

function ReplayCard({
  step,
  total,
  divider,
  prior,
  revealed,
  onToggle,
}: {
  step: ReplayStep<PackQuestion>;
  total: number;
  /** Session divider text shown above this card in a whole-day replay. */
  divider: string | null;
  /** Earlier attempts at this question, oldest first. */
  prior: Attempt[];
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
  const priorWrong = prior.filter((a) => !a.isCorrect).length;

  return (
    <li className="flex flex-col gap-3">
      {divider ? (
        <div
          data-testid="coach-session-divider"
          className="flex items-center gap-3 px-1 text-xs font-semibold uppercase tracking-wider text-ink-500"
        >
          <span className="h-px flex-1 bg-ink-200" />
          {divider}
          <span className="h-px flex-1 bg-ink-200" />
        </div>
      ) : null}
      <div
        data-testid="coach-step"
        data-revealed={revealed ? '1' : '0'}
        className="flex flex-col gap-3 rounded-2xl border border-ink-200 bg-surface p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <QuestionMeta question={question} hideTags />
          {scenario ? (
            <span className="rounded-full border border-ink-300 bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-700">
              {scenario.title}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-600">
            Q {step.index} / {total}
            <span aria-hidden>·</span>
            <Clock className="h-3 w-3" />
            <span className="normal-case">{formatSpan(attempt.timeTakenSeconds)}</span>
          </span>
          {prior.length > 0 ? (
            <span
              data-testid="coach-seen-before"
              className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-600"
            >
              <History className="h-3 w-3" />
              seen {prior.length}× before
            </span>
          ) : null}
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
            {prior.length > 0 ? (
              <div data-testid="coach-prior" className="text-sm text-ink-700">
                <div className="font-semibold text-ink-800">
                  {priorWrong === 0
                    ? `Before this: right every time (${prior.length}×).`
                    : `Before this: wrong ${priorWrong} of ${prior.length} ${prior.length === 1 ? 'time' : 'times'}.`}
                </div>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {prior.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 tabular-nums">
                      <span
                        className={cn(
                          'inline-block h-2 w-2 flex-shrink-0 rounded-full',
                          a.isCorrect ? 'bg-success-500' : 'bg-warn-500',
                        )}
                        aria-hidden
                      />
                      <span className="text-ink-500">{SHORT_DAY_FORMAT.format(new Date(a.answeredAt))}</span>
                      <span>
                        {a.isCorrect ? 'right' : `wrong — picked ${formatKeyList(selectedKeys(a) as OptionKey[])}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
      </div>
    </li>
  );
}
