'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { VoteRow } from '@/components/VoteRow';
import { NoteRow } from '@/components/NoteRow';
import { NoteOrigin } from '@/pack/NoteOrigin';
import { Scratchpad } from '@/components/Scratchpad';
import { SourceRef } from '@/components/SourceRef';
import { McqMarkdown } from '@/components/McqMarkdown';
import { OptionButtons } from '@/pack/OptionButtons';
import { PackImage } from '@/pack/PackImage';
import { ConceptCard } from '@/pack/ConceptCard';
import { QuestionMeta } from '@/pack/QuestionMeta';
import { Celebration } from '@/components/Celebration';
import type { Achievement } from '@/pack/achievements';
import { levelUpCelebration } from '@/pack/useLevelUp';
import type { XpLevel } from '@/lib/xp';
import {
  correctKeysOf,
  isMultiAnswer,
  packScenarios,
  PACK_CONCEPT_BY_ID,
  type OptionKey,
  type PackQuestion,
} from '@/pack/data';
import { formatKeyList, gradeSelection } from './runner';

/**
 * The screen pieces the visual runners (Practice, Review, Notes) share.
 * Each runner owns its session logic — what to deal, what to record, what
 * the results screen says — and composes these for the question itself,
 * so the three stay pixel-identical and a change to the question screen
 * lands once.
 */

export type Stage = 'choosing' | 'feedback';

/** Pill link back to where the runner was opened from. */
export function BackLink({ href = '/', label = 'Home' }: { href?: string; label?: string }) {
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

export function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round((current / total) * 100);
  return (
    <div className="flex w-32 items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full bg-brand-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-ink-500">
        {current}/{total}
      </span>
    </div>
  );
}

/** Placeholder between mount and the first dealt round. */
export function RunnerLoading({ back = <BackLink /> }: { back?: ReactNode }) {
  return (
    <main className="flex flex-col gap-5">
      {back}
      <div className="rounded-2xl border border-ink-200 bg-surface p-6 text-center text-ink-500 shadow-xs">
        Loading…
      </div>
    </main>
  );
}

/**
 * The toast stack: a sticker unlock outranks a level-up, which outranks
 * whatever the runner passes as `fallback` (the practice runner's streak
 * nod). One toast at a time — the hooks queue the rest.
 */
export function RunnerCelebrations({
  nextUnlock,
  clearNextUnlock,
  nextLevelUp,
  clearNextLevelUp,
  fallback = null,
}: {
  nextUnlock: Achievement | null;
  clearNextUnlock: () => void;
  nextLevelUp: XpLevel | null;
  clearNextLevelUp: () => void;
  fallback?: ReactNode;
}) {
  if (nextUnlock) {
    return <Celebration achievement={nextUnlock} onDone={clearNextUnlock} />;
  }
  if (nextLevelUp) {
    return (
      <Celebration
        label="Level up!"
        achievement={levelUpCelebration(nextLevelUp)}
        onDone={clearNextLevelUp}
      />
    );
  }
  return fallback;
}

/**
 * Everything above the answer: the header (back link + progress), the
 * metadata chip row, the shared scenario stem (only when it has one),
 * the prompt, its image, the scratchpad, and the option buttons.
 */
export function QuestionPanel({
  question,
  position,
  total,
  selected,
  stage,
  onSelect,
  back = <BackLink />,
  badge = null,
  banner = null,
}: {
  question: PackQuestion;
  /** 1-based index of the question in the round. */
  position: number;
  total: number;
  selected: OptionKey[];
  stage: Stage;
  onSelect: (key: OptionKey) => void;
  back?: ReactNode;
  /** A mode chip rendered first in the metadata row ("Review mistakes"). */
  badge?: ReactNode;
  /** Rendered between the header and the chip row (the repeat-round notice). */
  banner?: ReactNode;
}) {
  const scenario = question.scenarioId
    ? packScenarios.find((s) => s.id === question.scenarioId)
    : undefined;
  const multi = isMultiAnswer(question);

  return (
    <>
      <header className="flex items-center justify-between">
        {back}
        <ProgressBar current={position} total={total} />
      </header>

      {banner}

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        {badge}
        <QuestionMeta question={question} />
        {scenario ? (
          <span className="rounded-full border border-ink-300 bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-700">
            {scenario.title}
          </span>
        ) : null}
        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-600">
          Q {position} / {total}
        </span>
      </div>

      {/* Only show the scenario card when there's a real shared stem. */}
      {scenario?.stem ? (
        <section className="rounded-2xl border border-ink-200 bg-ink-50/60 p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Scenario
          </div>
          <div className="mt-0.5 text-base font-semibold text-ink-900">
            {scenario.title}
          </div>
          <div className="mt-2 text-[15px] leading-relaxed text-ink-800">
            <McqMarkdown text={scenario.stem} />
          </div>
        </section>
      ) : null}

      <div className="rounded-2xl border border-ink-200 bg-surface p-5 shadow-xs">
        <div className="text-[15px] leading-relaxed text-ink-900">
          <McqMarkdown text={question.prompt} />
        </div>
      </div>

      {question.image ? (
        <div className="flex justify-center rounded-2xl border border-ink-200 bg-surface p-4 shadow-xs">
          <PackImage
            src={question.image}
            alt=""
            className="max-h-72 w-auto object-contain"
          />
        </div>
      ) : null}

      <Scratchpad />

      {multi ? (
        <div className="-mb-1 flex items-center gap-1.5 text-xs font-semibold text-brand-700">
          <ListChecks className="h-4 w-4" />
          Select all that apply
        </div>
      ) : null}

      <OptionButtons
        options={question.options}
        selected={selected}
        stage={stage}
        correctKeys={correctKeysOf(question)}
        multi={multi}
        onSelect={onSelect}
      />
    </>
  );
}

/**
 * Below the options: the "Check answer" button while choosing, then the
 * feedback box — verdict, the right answer when missed, explanation,
 * concept card, source, note origin, vote + note rows, and Next.
 */
export function AnswerPanel({
  question,
  selected,
  stage,
  verdict,
  xpGained = null,
  isLast,
  onCheck,
  onNext,
}: {
  question: PackQuestion;
  selected: OptionKey[];
  stage: Stage;
  /** Feedback headline for a right / wrong answer. */
  verdict: { correct: string; wrong: string };
  /** XP the answer earned, shown as a chip; null = nothing to show. */
  xpGained?: number | null;
  /** Next ends the round ("See results" instead of "Next question"). */
  isLast: boolean;
  onCheck: () => void;
  onNext: () => void;
}) {
  if (stage === 'choosing') {
    return (
      <Button size="lg" block onClick={onCheck} disabled={selected.length === 0}>
        Check answer
      </Button>
    );
  }

  const isCorrect = gradeSelection(question, selected);
  const answerKeys = correctKeysOf(question);
  const concept = question.conceptId ? PACK_CONCEPT_BY_ID[question.conceptId] : undefined;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4',
        isCorrect
          ? 'border-success-500/30 bg-success-100/60'
          : 'border-warn-500/30 bg-warn-100/60',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            'text-lg font-bold',
            isCorrect ? 'text-success-700' : 'text-warn-700',
          )}
        >
          {isCorrect ? verdict.correct : verdict.wrong}
        </div>
        {xpGained !== null ? (
          <span
            data-testid="xp-chip"
            className="rounded-full bg-brand-500/15 px-2 py-0.5 text-xs font-semibold text-brand-700"
          >
            +{xpGained} XP
          </span>
        ) : null}
      </div>
      {!isCorrect ? (
        <div className="text-[15px] text-ink-700">
          {answerKeys.length > 1 ? 'The answers are ' : 'The answer is '}
          <span className="font-semibold text-ink-900">
            {formatKeyList(answerKeys)}
          </span>
          .
        </div>
      ) : null}
      <div className="text-[15px] leading-relaxed text-ink-800">
        <McqMarkdown text={question.explanation} />
      </div>
      {concept ? (
        <ConceptCard concept={concept} defaultOpen={!isCorrect} />
      ) : null}
      <SourceRef sourceRef={question.sourceRef} />
      <NoteOrigin generatedFrom={question.generatedFrom} />
      {/* keyed so per-question draft state resets when the question advances */}
      <VoteRow key={`vote-${question.id}`} questionId={question.id} />
      <NoteRow key={`note-${question.id}`} questionId={question.id} />
      <Button size="lg" block onClick={onNext} className="mt-1">
        {isLast ? 'See results' : 'Next question'}
      </Button>
    </div>
  );
}
