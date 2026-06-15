import { describe, expect, it } from 'vitest';
import { deriveSyncState } from '../src/lib/sync';

describe('deriveSyncState', () => {
  it('is idle whenever signed out, regardless of network or queue', () => {
    expect(deriveSyncState(false, true, 0, false)).toBe('idle');
    expect(deriveSyncState(false, false, 5, true)).toBe('idle');
  });

  it('reports offline while signed in with no connection', () => {
    expect(deriveSyncState(true, false, 0, false)).toBe('offline');
    // Offline takes precedence even with work waiting to go up.
    expect(deriveSyncState(true, false, 12, false)).toBe('offline');
  });

  it('reports syncing while online with pending work or an active drain', () => {
    expect(deriveSyncState(true, true, 3, false)).toBe('syncing');
    expect(deriveSyncState(true, true, 0, true)).toBe('syncing');
  });

  it('reports synced (caught up) when online, idle, and empty', () => {
    expect(deriveSyncState(true, true, 0, false)).toBe('synced');
  });
});
