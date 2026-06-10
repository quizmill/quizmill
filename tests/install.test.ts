import { describe, expect, it } from 'vitest';
import { describeInstallSurface } from '@/lib/install';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
// iPadOS 13+ pretends to be desktop Safari; only maxTouchPoints exposes it.
const IPADOS_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

describe('describeInstallSurface', () => {
  it('standalone wins regardless of user agent', () => {
    expect(describeInstallSurface(IPHONE_UA, true)).toBe('standalone');
    expect(describeInstallSurface(CHROME_UA, true)).toBe('standalone');
  });

  it('detects iPhone and iPad Safari', () => {
    expect(describeInstallSurface(IPHONE_UA, false)).toBe('ios');
    expect(describeInstallSurface(IPAD_UA, false)).toBe('ios');
  });

  it('detects iPadOS masquerading as macOS via touch points', () => {
    expect(describeInstallSurface(IPADOS_DESKTOP_UA, false, 5)).toBe('ios');
    // A real Mac (no touch screen) stays a plain browser.
    expect(describeInstallSurface(IPADOS_DESKTOP_UA, false, 0)).toBe('browser');
  });

  it('treats everything else as a plain browser', () => {
    expect(describeInstallSurface(CHROME_UA, false)).toBe('browser');
    expect(describeInstallSurface(ANDROID_UA, false)).toBe('browser');
  });
});
