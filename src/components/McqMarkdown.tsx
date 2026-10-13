'use client';

import { Fragment, useMemo, type ReactNode } from 'react';

/**
 * Minimal markdown for MCQ prompts / options / explanations: fenced
 * code blocks, inline backticks, `**bold**` / `*italic*`, and
 * auto-linkified bare URLs.
 *
 * `linkify={false}` leaves URLs as plain text — for content rendered
 * inside an interactive element (a `<button>`), where a nested `<a>` is
 * invalid HTML and unreachable while the button is disabled.
 */
export function McqMarkdown({ text, linkify = true }: { text: string; linkify?: boolean }) {
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
            <InlineMarkdown text={seg.text} linkify={linkify} />
          )}
        </Fragment>
      ))}
    </>
  );
}

function InlineMarkdown({ text, linkify }: { text: string; linkify: boolean }): ReactNode {
  const tokens = useMemo(() => parseInline(text), [text]);
  return <span className="whitespace-pre-line">{renderTokens(tokens, linkify)}</span>;
}

function renderTokens(tokens: InlineToken[], linkify: boolean): ReactNode[] {
  return tokens.map((t, i) => {
    switch (t.kind) {
      case 'code':
        return (
          <code
            key={i}
            className="rounded-sm bg-ink-100 px-1 py-0.5 font-mono text-[12.5px] text-ink-800"
          >
            {t.text}
          </code>
        );
      case 'strong':
        return (
          <strong key={i} className="font-semibold">
            {renderTokens(t.children, linkify)}
          </strong>
        );
      case 'em':
        return <em key={i}>{renderTokens(t.children, linkify)}</em>;
      default:
        return <Fragment key={i}>{linkify ? linkifyUrls(t.text) : t.text}</Fragment>;
    }
  });
}

type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong' | 'em'; children: InlineToken[] };

/**
 * Inline tokenizer: code spans are atomic (asterisks inside them stay
 * literal), `**` / `*` open emphasis only when followed by a non-space
 * and close only when preceded by one — so `3 * 4 * 5`, `2 ** 3` and a
 * leading `* ` stay literal. Emphasis never spans a line break; anything
 * still open at a newline or the end is flattened back to literal text.
 */
function parseInline(text: string): InlineToken[] {
  type Frame = { delim: '**' | '*' | null; children: InlineToken[] };
  const stack: Frame[] = [{ delim: null, children: [] }];
  const top = () => stack[stack.length - 1];
  const pushText = (s: string) => {
    if (!s) return;
    const children = top().children;
    const last = children[children.length - 1];
    if (last?.kind === 'text') last.text += s;
    else children.push({ kind: 'text', text: s });
  };
  /** Unwind frames above (and including) index `to`, turning their
   *  delimiters back into text. */
  const flatten = (to: number) => {
    while (stack.length > to) {
      const frame = stack.pop();
      if (!frame) break;
      pushText(frame.delim ?? '');
      for (const child of frame.children) {
        if (child.kind === 'text') pushText(child.text);
        else top().children.push(child);
      }
    }
  };

  const re = /`([^`\n]+)`|\*\*|\*|\n/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    pushText(text.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    const tok = match[0];
    if (tok === '\n') {
      flatten(1);
      pushText('\n');
    } else if (tok.startsWith('`')) {
      top().children.push({ kind: 'code', text: match[1] });
    } else {
      const delim = tok as '**' | '*';
      const before = text[match.index - 1];
      const after = text[lastIndex];
      const canClose = before !== undefined && !/\s/.test(before) && before !== '*';
      const canOpen = after !== undefined && !/\s/.test(after) && after !== '*';
      const openIdx = canClose ? stack.map((f) => f.delim).lastIndexOf(delim) : -1;
      if (openIdx > 0) {
        flatten(openIdx + 1);
        const { children } = stack.pop() ?? { children: [] };
        top().children.push({ kind: delim === '**' ? 'strong' : 'em', children });
      } else if (canOpen) {
        stack.push({ delim, children: [] });
      } else {
        pushText(delim);
      }
    }
  }
  pushText(text.slice(lastIndex));
  flatten(1);
  return stack[0].children;
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
