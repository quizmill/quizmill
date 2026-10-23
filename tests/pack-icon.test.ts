import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePackAssets } from '../scripts/pack-assets';

// The PWA icon and webmanifest are derived from the active pack. By
// default the icon is the pack's initials on its theme colour; a pack
// that ships `assets/icon.svg` gets that file as its app icon instead
// (the starter pack uses it for the mill-wheel mark). The home-screen
// label is the title itself when it is short enough to fit under an
// icon, else the initials as before.

const MANIFEST = {
  title: 'Solar System Practice',
  description: 'Demo learning pack.',
  themeColor: '#0f766e',
};

let tmp: string;
let publicDir: string;
let packDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-icon-'));
  publicDir = path.join(tmp, 'public');
  packDir = path.join(tmp, 'pack');
  fs.mkdirSync(publicDir);
  fs.mkdirSync(packDir);
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const icon = () => fs.readFileSync(path.join(publicDir, 'icon.svg'), 'utf8');
const webmanifest = () =>
  JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));

describe('writePackAssets', () => {
  it('draws the initials on the theme colour when the pack ships no icon', () => {
    writePackAssets(MANIFEST, { packDir, publicDir });
    expect(icon()).toContain('>SSP</text>');
    expect(icon()).toContain('fill="#0f766e"');
    expect(webmanifest().short_name).toBe('SSP');
    expect(webmanifest().name).toBe('Solar System Practice');
  });

  it('uses the pack’s own assets/icon.svg as the app icon when it ships one', () => {
    fs.mkdirSync(path.join(packDir, 'assets'));
    const mark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle r="5"/></svg>\n';
    fs.writeFileSync(path.join(packDir, 'assets', 'icon.svg'), mark);
    writePackAssets(MANIFEST, { packDir, publicDir });
    expect(icon()).toBe(mark);
    // The webmanifest still points at icon.svg and keeps the pack's name.
    expect(webmanifest().icons[0].src).toBe('icon.svg');
    expect(webmanifest().theme_color).toBe('#0f766e');
  });

  it('lists a full-bleed copy of the generated icon as the maskable one', () => {
    // Launchers that cut their own shape (Android) otherwise pad the
    // rounded icon inside a white disc; the maskable copy has no rounding.
    writePackAssets(MANIFEST, { packDir, publicDir });
    const [any, maskable] = webmanifest().icons;
    expect(any).toMatchObject({ src: 'icon.svg', purpose: 'any' });
    expect(maskable).toMatchObject({ src: 'icon-maskable.svg', purpose: 'maskable', type: 'image/svg+xml' });
    const svg = fs.readFileSync(path.join(publicDir, 'icon-maskable.svg'), 'utf8');
    expect(svg).toContain('>SSP</text>');
    expect(svg).not.toContain('rx=');
  });

  it('uses the pack’s own assets/icon-maskable.svg when it ships one, and lists none otherwise', () => {
    fs.mkdirSync(path.join(packDir, 'assets'));
    const mark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle r="5"/></svg>\n';
    fs.writeFileSync(path.join(packDir, 'assets', 'icon.svg'), mark);
    // Own icon, no maskable: nothing is invented — unknown artwork could be cropped.
    writePackAssets(MANIFEST, { packDir, publicDir });
    expect(webmanifest().icons.map((i: { purpose: string }) => i.purpose)).toEqual(['any']);
    expect(fs.existsSync(path.join(publicDir, 'icon-maskable.svg'))).toBe(false);
    // Own maskable: used verbatim.
    const full = mark.replace('<circle', '<rect width="64" height="64"/><circle');
    fs.writeFileSync(path.join(packDir, 'assets', 'icon-maskable.svg'), full);
    writePackAssets(MANIFEST, { packDir, publicDir });
    expect(webmanifest().icons[1]).toMatchObject({ src: 'icon-maskable.svg', purpose: 'maskable' });
    expect(fs.readFileSync(path.join(publicDir, 'icon-maskable.svg'), 'utf8')).toBe(full);
  });

  it('writes a PNG apple-touch-icon: the pack’s assets/icon.png, else a theme-colour tile', () => {
    // iOS ignores an SVG apple-touch-icon and falls back to a page
    // screenshot, so every build ships a raster one.
    const png = () => fs.readFileSync(path.join(publicDir, 'apple-touch-icon.png'));
    writePackAssets(MANIFEST, { packDir, publicDir });
    const generated = png();
    expect(generated.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // IHDR: 180 × 180, 8-bit RGB.
    expect(generated.readUInt32BE(16)).toBe(180);
    expect(generated.readUInt32BE(20)).toBe(180);
    expect(generated[24]).toBe(8);
    expect(generated[25]).toBe(2);
    fs.mkdirSync(path.join(packDir, 'assets'));
    fs.writeFileSync(path.join(packDir, 'assets', 'icon.png'), Buffer.from('not really a png'));
    writePackAssets(MANIFEST, { packDir, publicDir });
    expect(png().toString()).toBe('not really a png');
  });

  it('labels the home-screen icon with a short title itself, not its initial', () => {
    writePackAssets({ ...MANIFEST, title: 'quizmill' }, { packDir, publicDir });
    expect(webmanifest().short_name).toBe('quizmill');
    expect(webmanifest().name).toBe('quizmill');
    // Long titles keep the initials — "Solar System Practice" → SSP above.
    writePackAssets({ ...MANIFEST, title: 'Kubernetes Networking' }, { packDir, publicDir });
    expect(webmanifest().short_name).toBe('KN');
  });
});
