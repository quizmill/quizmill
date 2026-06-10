import { McqMarkdown } from '@/components/McqMarkdown';
import type { PackConcept } from '@/pack/data';

/**
 * A short teaching card surfaced in the feedback panel after an answer
 * (a question links one via conceptId). Collapsible — open by default
 * when the answer was wrong, where it's most useful.
 */
export function ConceptCard({
  concept,
  defaultOpen = false,
}: {
  concept: PackConcept;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-xl border border-ink-200 bg-white/70 px-3.5 py-2.5"
    >
      <summary className="cursor-pointer list-none text-sm font-semibold text-ink-800">
        📖 Learn: {concept.title}
      </summary>
      <div className="mt-2 text-[14px] leading-relaxed text-ink-700">
        <McqMarkdown text={concept.body} />
      </div>

      {concept.example ? (
        <div className="mt-3 rounded-lg bg-ink-50 p-3 text-[13.5px]">
          <div className="font-semibold text-ink-800">Worked example</div>
          <div className="mt-1 text-ink-700">
            <McqMarkdown text={concept.example.question} />
          </div>
          {concept.example.steps && concept.example.steps.length > 0 ? (
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-ink-700">
              {concept.example.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : null}
          <div className="mt-1.5 font-semibold text-ink-900">
            Answer: {concept.example.answer}
          </div>
        </div>
      ) : null}

      {concept.commonMistakes && concept.commonMistakes.length > 0 ? (
        <div className="mt-3 text-[13.5px]">
          <div className="font-semibold text-ink-800">Common mistakes</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-700">
            {concept.commonMistakes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  );
}
