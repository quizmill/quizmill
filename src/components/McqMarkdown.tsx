'use client';

import { Fragment, useMemo, type ReactNode } from 'react';

/**
 * Minimal markdown for MCQ prompts / options / explanations: fenced
 * code blocks, inline backticks, and auto-linkified bare URLs.
 *
 * Lifted from the copies in the claude-cert runners (which carry a
 * "lift to a shared component if a third caller appears" note — the
 * pack variant is that third caller). The CCA runners still hold their
 * own copies; migrating them here is a small follow-up. Keep the
 * behaviour in sync until then.
 */
export function McqMarkdown({ text }: { text: string }) {
  const segments = useMemo(() => splitMarkdown(text), [text]);
  return (
    <>
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {seg.kind === 'code-block' ? (
            <pre className="my-2 overflow-x-auto rounded-lg bg-night-900 px-3 py-2 text-[12px] leading-relaxed text-white">
              <code>{seg.text}</code>
            </pre>
          ) : (
            <InlineMarkdown text={seg.text} />
          )}
        </Fragment>
      ))}
    </>
  );
}

function InlineMarkdown({ text }: { text: string }): ReactNode {
  const parts = text.split(/`([^`\n]+)`/);
  return (
    <span className="whitespace-pre-line">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[12.5px] text-ink-800"
          >
            {p}
          </code>
        ) : (
          <Fragment key={i}>{linkifyUrls(p)}</Fragment>
        ),
      )}
    </span>
  );
}

function linkifyUrls(text: string): ReactNode[] {
  const re = /(https?:\/\/[^\s)\]]+?)(?=[)\].,;:!?]?(?:\s|$))/g;
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    const url = match[1];
    out.push(
      <a
        key={`link-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand-700 underline underline-offset-2 hover:text-brand-900"
      >
        {url}
      </a>,
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

type Segment = { kind: 'text' | 'code-block'; text: string };

function splitMarkdown(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, match.index) });
    }
    segments.push({ kind: 'code-block', text: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: 'text', text: text.slice(lastIndex) });
  }
  return segments;
}
