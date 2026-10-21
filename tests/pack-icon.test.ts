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

  it('labels the home-screen icon with a short title itself, not its initial', () => {
    writePackAssets({ ...MANIFEST, title: 'quizmill' }, { packDir, publicDir });
    expect(webmanifest().short_name).toBe('quizmill');
    expect(webmanifest().name).toBe('quizmill');
    // Long titles keep the initials — "Solar System Practice" → SSP above.
    writePackAssets({ ...MANIFEST, title: 'Kubernetes Networking' }, { packDir, publicDir });
    expect(webmanifest().short_name).toBe('KN');
  });
});
