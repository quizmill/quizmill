import { cn } from '@/lib/cn';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Render a pack-relative image asset. Pack images live in the pack's
 * `assets/` directory and are copied to `/pack-assets/` at build time
 * (scripts/pack-assets.ts). A plain <img> — the app is a static export,
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
  const resolved = src.startsWith('http')
    ? src
    : `${BASE_PATH}/pack-assets/${src.replace(/^\/+/, '')}`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolved} alt={alt ?? ''} className={cn(className)} />;
}
