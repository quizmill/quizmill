import { cn } from '@/lib/cn';
import { getActivePackOverride } from '@/pack/runtime';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Resolve a pack-relative image path to a URL, exported for tests.
 *
 * Absolute http(s) URLs pass through untouched. Relative paths resolve
 * against the RUNTIME pack's recorded `assetsBase` when one is active
 * (a runtime-inserted pack ships no files in this deployment, so its
 * images live wherever the pack was inserted from), and otherwise
 * against the app's own `/pack-assets/` — the build-time pack's assets,
 * mirrored there by scripts/pack-assets.ts.
 */
export function resolvePackImageSrc(src: string): string {
  if (src.startsWith('http')) return src;
  const relative = src.replace(/^\/+/, '');
  const assetsBase = getActivePackOverride()?.assetsBase;
  if (assetsBase) return `${assetsBase.replace(/\/+$/, '')}/${relative}`;
  return `${BASE_PATH}/pack-assets/${relative}`;
}

/**
 * Render a pack image asset. A plain <img> — the app is a static export,
 * and pack image dimensions aren't known ahead of time.
 */
export function PackImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolvePackImageSrc(src)} alt={alt ?? ''} className={cn(className)} />;
}
