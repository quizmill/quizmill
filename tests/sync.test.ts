import { describe, expect, it } from 'vitest';
import { deriveSyncState } from '../src/lib/sync';

describe('deriveSyncState', () => {
  it('is idle whenever signed out, regardless of network or queue', () => {
    expect(deriveSyncState(false, true, 0, false, false)).toBe('idle');
    expect(deriveSyncState(false, false, 5, true, true)).toBe('idle');
  });

  it('reports offline while signed in with no connection', () => {
    expect(deriveSyncState(true, false, 0, false, false)).toBe('offline');
    // Offline takes precedence even with work waiting to go up.
    expect(deriveSyncState(true, false, 12, false, true)).toBe('offline');
  });

  it('reports syncing while online with pending work or an active drain', () => {
    expect(deriveSyncState(true, true, 3, false, false)).toBe('syncing');
    expect(deriveSyncState(true, true, 0, true, false)).toBe('syncing');
  });

  it('treats an in-flight drain as syncing even after an earlier failure', () => {
    // Actively retrying — don't flash an error while a pass is running.
    expect(deriveSyncState(true, true, 5, true, true)).toBe('syncing');
  });

  it('reports error when a finished pass left pending work it could not clear', () => {
    expect(deriveSyncState(true, true, 5, false, true)).toBe('error');
  });

  it('reports synced (caught up) when online, idle, and empty', () => {
    expect(deriveSyncState(true, true, 0, false, false)).toBe('synced');
    // A stale error flag is irrelevant once the queue is empty.
    expect(deriveSyncState(true, true, 0, false, true)).toBe('synced');
  });
});
