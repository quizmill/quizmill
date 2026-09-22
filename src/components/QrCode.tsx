import qrcodegen from 'qrcode-generator';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';

/**
 * Render a QR code as an inline SVG — one path of dark modules, filled
 * with currentColor so it prints pure black under the paper-sheet print
 * rules and follows the text colour on screen. Type number 0 = pick the
 * smallest version that fits; level M survives a phone photo of a
 * slightly crumpled worksheet.
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
        if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return { path: d, size: n };
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
