import { describe, expect, it } from 'vitest';
import { upgradeHref } from '@/lib/upgrade';

describe('upgradeHref', () => {
  it('appends ?ref=<packId>-<placement> to a bare URL', () => {
    expect(upgradeHref('https://example.com/course', 'my-pack', 'home')).toBe(
      'https://example.com/course?ref=my-pack-home',
    );
    expect(upgradeHref('https://example.com/course', 'my-pack', 'settings')).toBe(
      'https://example.com/course?ref=my-pack-settings',
    );
  });

  it('keeps an existing query string and overrides a stale ref', () => {
    expect(
      upgradeHref('https://example.com/course?utm_source=app&ref=old', 'my-pack', 'home'),
    ).toBe('https://example.com/course?utm_source=app&ref=my-pack-home');
  });

  it('keeps a fragment after the query', () => {
    expect(upgradeHref('https://example.com/course#pricing', 'my-pack', 'settings')).toBe(
      'https://example.com/course?ref=my-pack-settings#pricing',
    );
  });
});
