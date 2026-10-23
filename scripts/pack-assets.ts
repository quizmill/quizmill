/**
 * Generate the pack variant's PWA assets — public/manifest.webmanifest,
 * public/icon.svg, public/icon-maskable.svg and public/apple-touch-icon.png
 * — from the active pack's manifest. The other variants commit these files
 * by hand; for packs they're derived (and gitignored), so the app icon and
 * install banner always match the pack.
 *
 * The icon is the pack's initials on its theme colour unless the pack
 * ships its own: `<packDir>/assets/icon.svg` is used verbatim when it
 * exists (the starter pack carries the millstone mark that way). Two
 * more forms sit next to it, because one icon file does not survive
 * every launcher:
 *
 *  - `icon-maskable.svg` (`purpose: maskable`) is full-bleed artwork for
 *    launchers that cut their own shape — Android pads a `purpose: any`
 *    icon inside a white disc otherwise. The generated initials icon gets
 *    a full-bleed copy for free; a pack that ships its own `icon.svg` can
 *    ship `assets/icon-maskable.svg` beside it (nothing is invented from
 *    unknown artwork, which could be cropped).
 *  - `apple-touch-icon.png`: iOS ignores an SVG apple-touch-icon and
 *    falls back to a page screenshot. The pack's `assets/icon.png` is
 *    copied when it ships one; otherwise a flat theme-colour tile is
 *    encoded here (no rasteriser at build time, so no initials on it).
 *
 * The home-screen label (`short_name`) is the title itself when it is
 * short enough to sit under an icon, else the initials.
 *
 * Called by ensure-pack.ts and use-pack.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

interface PackManifestLike {
  title: string;
  description: string;
  themeColor: string;
}

const PUBLIC = path.join(__dirname, '..', 'public');

/** Longest title shown as-is under the home-screen icon; the webmanifest
 *  spec suggests ~12 characters before launchers start truncating. */
const SHORT_NAME_MAX = 12;

/** apple-touch-icon edge: iOS asks for 180 × 180 (60pt at 3×). */
const APPLE_ICON_SIZE = 180;

/** Initials for the icon: first letter of up to three title words. */
function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => /^[a-zA-Z0-9]/.test(w))
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** A file the pack ships under `assets/`, if it does. */
function packAsset(packDir: string | undefined, name: string): Buffer | null {
  if (!packDir) return null;
  const file = path.join(packDir, 'assets', name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return fs.readFileSync(file);
}

/** The initials on the theme colour; `rounded` is the `any` icon (matches
 *  the hand-made variant icons), full-bleed is the maskable copy. */
function initialsIcon(abbrev: string, themeColor: string, rounded: boolean): string {
  // Shrink the font as the abbreviation widens.
  const fontSize = abbrev.length >= 3 ? 200 : abbrev.length === 2 ? 240 : 280;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512"${rounded ? ' rx="96"' : ''} fill="${themeColor}"/>` +
    `<text x="256" y="332" font-family="system-ui, -apple-system, sans-serif" ` +
    `font-weight="800" font-size="${fontSize}" fill="white" text-anchor="middle" ` +
    `letter-spacing="-8">${abbrev}</text></svg>\n`
  );
}

/** A flat-colour square PNG (8-bit RGB), encoded by hand: a chunk header,
 *  one deflated run of filter-0 scanlines, the end marker. Enough for an
 *  apple-touch-icon fallback without pulling in a rasteriser. */
export function solidPng(size: number, hex: string): Buffer {
  const rgb = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '334155';
  const px = Buffer.from(rgb, 'hex');
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, px)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writePackAssets(
  manifest: PackManifestLike,
  opts: {
    /** The active pack's directory — looked in for `assets/icon*`. */
    packDir?: string;
    /** Where to write; the app's `public/` unless a test says otherwise. */
    publicDir?: string;
  } = {},
): void {
  const publicDir = opts.publicDir ?? PUBLIC;
  const abbrev = initials(manifest.title) || 'LP';

  const ownIcon = packAsset(opts.packDir, 'icon.svg');
  const icon = ownIcon ?? initialsIcon(abbrev, manifest.themeColor, true);
  const maskable = ownIcon
    ? packAsset(opts.packDir, 'icon-maskable.svg')
    : initialsIcon(abbrev, manifest.themeColor, false);
  const apple =
    packAsset(opts.packDir, 'icon.png') ?? solidPng(APPLE_ICON_SIZE, manifest.themeColor);

  const svgIcon = (src: string, purpose: 'any' | 'maskable') => ({
    src,
    sizes: 'any',
    type: 'image/svg+xml',
    purpose,
  });
  const webmanifest = {
    name: manifest.title,
    short_name: manifest.title.length <= SHORT_NAME_MAX ? manifest.title : abbrev,
    description: manifest.description,
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f8fafc',
    theme_color: manifest.themeColor,
    icons: [
      svgIcon('icon.svg', 'any'),
      ...(maskable ? [svgIcon('icon-maskable.svg', 'maskable')] : []),
    ],
  };

  fs.writeFileSync(
    path.join(publicDir, 'manifest.webmanifest'),
    JSON.stringify(webmanifest, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(publicDir, 'icon.svg'), icon);
  // Never leave a previous pack's maskable copy behind.
  const maskableFile = path.join(publicDir, 'icon-maskable.svg');
  if (maskable) fs.writeFileSync(maskableFile, maskable);
  else fs.rmSync(maskableFile, { force: true });
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), apple);
}

/**
 * Mirror a pack's image assets (`<packDir>/assets/`) into
 * `public/pack-assets/`, where the static export serves them at
 * `/pack-assets/…` (referenced by question/option `image` paths).
 *
 * The target is cleared first so switching packs never leaves a previous
 * pack's images behind. No-op when the pack ships no `assets/` dir.
 */
export function syncPackAssets(packDir: string): void {
  const dest = path.join(PUBLIC, 'pack-assets');
  fs.rmSync(dest, { recursive: true, force: true });
  const src = path.join(packDir, 'assets');
  if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true });
}
