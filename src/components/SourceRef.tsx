/**
 * Per-question source attribution. Packs built on someone else's
 * question bank carry an upstream URL in `sourceRef`; surfacing it in
 * the feedback panel keeps credit with the original authors. Renders
 * nothing for non-URL refs (internal notes) or unsourced questions.
 */
import { ExternalLink } from 'lucide-react';

export function SourceRef({ sourceRef }: { sourceRef?: string }) {
  if (!sourceRef) return null;
  // sourceRef may hold several refs separated by ';' — link the first URL.
  const url = sourceRef
    .split(';')
    .map((s) => s.trim())
    .find((s) => /^https?:\/\//.test(s));
  if (!url) return null;

  let host: string;
  let label: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    label =
      host === 'github.com'
        ? parsed.pathname.split('/').slice(1, 3).join('/')
        : host;
  } catch {
    return null;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 self-start text-xs font-medium text-ink-500 underline-offset-2 hover:text-ink-700 hover:underline"
    >
      <ExternalLink className="h-3 w-3" />
      Source: {label}
    </a>
  );
}
