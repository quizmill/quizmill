import qrcodegen from 'qrcode-generator';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';

/** Quiet-zone width in modules on each side. The QR spec requires 4 —
 *  scanners genuinely refuse codes whose surroundings (the sheet code
 *  text, the header rule) crowd the symbol. */
export const QR_QUIET_ZONE = 4;

/**
 * Render a QR code as an inline SVG — one path of dark modules, filled
 * with currentColor so it prints pure black under the paper-sheet print
 * rules and follows the text colour on screen. Type number 0 = pick the
 * smallest version that fits; level M survives a phone photo of a
 * slightly crumpled worksheet. The spec's 4-module quiet zone is part
 * of the SVG itself, so no surrounding layout can crowd it away.
 */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const { path, size } = useMemo(() => {
    const qr = qrcodegen(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) {
          d += `M${c + QR_QUIET_ZONE} ${r + QR_QUIET_ZONE}h1v1h-1z`;
        }
      }
    }
    return { path: d, size: n + QR_QUIET_ZONE * 2 };
  }, [value]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn(className)}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code linking to the marking page for this sheet"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
