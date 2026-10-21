/**
 * Generate the pack variant's PWA assets — public/manifest.webmanifest
 * and public/icon.svg — from the active pack's manifest. The other
 * variants commit these files by hand; for packs they're derived (and
 * gitignored), so the app icon and install banner always match the pack.
 *
 * The icon is the pack's initials on its theme colour unless the pack
 * ships its own: `<packDir>/assets/icon.svg` is used verbatim when it
 * exists (the starter pack carries the mill-wheel mark that way). The
 * home-screen label (`short_name`) is the title itself when it is short
 * enough to sit under an icon, else the initials.
 *
 * Called by ensure-pack.ts and use-pack.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

interface PackManifestLike {
  title: string;
  description: string;
  themeColor: string;
}

const PUBLIC = path.join(__dirname, '..', 'public');

/** Longest title shown as-is under the home-screen icon; the webmanifest
 *  spec suggests ~12 characters before launchers start truncating. */
const SHORT_NAME_MAX = 12;

/** Initials for the icon: first letter of up to three title words. */
function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => /^[a-zA-Z0-9]/.test(w))
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** The pack's own app icon, if it ships one at `assets/icon.svg`. */
function packIcon(packDir: string | undefined): string | null {
  if (!packDir) return null;
  const file = path.join(packDir, 'assets', 'icon.svg');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return fs.readFileSync(file, 'utf8');
}

export function writePackAssets(
  manifest: PackManifestLike,
  opts: {
    /** The active pack's directory — looked in for `assets/icon.svg`. */
    packDir?: string;
    /** Where to write; the app's `public/` unless a test says otherwise. */
    publicDir?: string;
  } = {},
): void {
  const publicDir = opts.publicDir ?? PUBLIC;
  const abbrev = initials(manifest.title) || 'LP';
  // Match the hand-made variant icons (rounded square + bold initials);
  // shrink the font as the abbreviation widens.
  const fontSize = abbrev.length >= 3 ? 200 : abbrev.length === 2 ? 240 : 280;
  const icon =
    packIcon(opts.packDir) ??
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
      `<rect width="512" height="512" rx="96" fill="${manifest.themeColor}"/>` +
      `<text x="256" y="332" font-family="system-ui, -apple-system, sans-serif" ` +
      `font-weight="800" font-size="${fontSize}" fill="white" text-anchor="middle" ` +
      `letter-spacing="-8">${abbrev}</text></svg>\n`;

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
      {
        src: 'icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };

  fs.writeFileSync(
    path.join(publicDir, 'manifest.webmanifest'),
    JSON.stringify(webmanifest, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(publicDir, 'icon.svg'), icon);
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
