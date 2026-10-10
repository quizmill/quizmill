/**
 * The one engine behind every device-level preference: colour scheme,
 * visual look, the Levels & XP off-switch, Coach mode, Paper practice,
 * the analytics switch. Each is a single app-level localStorage key
 * (bare `quizmill.` prefix — about the device, not any one pack, never
 * synced, untouched by "Reset all local progress") read as a bare
 * string, plus a window event so every mounted hook re-reads after a
 * save. The concrete modules only say WHAT is stored — key, event, how
 * to read a string and how to write one — and this factory owns HOW:
 *
 *  - the SSR guard (no window → the fallback, saves are no-ops);
 *  - try/catch around localStorage, which throws in private mode and
 *    under storage policies — a read failure is the fallback, never a
 *    crash;
 *  - the change event, fired after every save whether or not the write
 *    landed, so the page still reacts;
 *  - a refused WRITE (quota, policy) is honoured in memory for the rest
 *    of the page: without this the toggle flips on screen and the next
 *    `load()` says the old value. Storage takes over again the moment a
 *    write succeeds, so an edit from another tab is never shadowed;
 *  - the legacy-key promotion the theme needs (`legacyKey`): an older
 *    per-pack key read once, copied to the current key and removed.
 *
 * Storage keys and event names are the concrete modules' business and
 * stay exactly as they were, so nothing a device has saved changes.
 */

export interface DevicePrefSpec<T> {
  /** The app-level localStorage key. */
  key: string;
  /** Local window event fired after every save so mounted hooks re-read. */
  event: string;
  /** The value when nothing (or junk) is stored, and outside a browser. */
  fallback: T;
  /** Stored string → value; `undefined` means junk, read as the fallback. */
  parse: (raw: string) => T | undefined;
  /** Value → stored string; `null` removes the key (the fallback's spelling). */
  serialise: (value: T) => string | null;
  /** An older key to promote on first read, then forget. */
  legacyKey?: string;
}

export interface DevicePref<T> {
  readonly key: string;
  readonly event: string;
  readonly fallback: T;
  load(): T;
  save(value: T): void;
  /** Test seam — drop the in-memory copy so the next read goes to storage. */
  resetForTests(): void;
}

export function devicePref<T>(spec: DevicePrefSpec<T>): DevicePref<T> {
  const { key, event, fallback, parse, serialise, legacyKey } = spec;

  /**
   * The value as last saved on THIS page when localStorage refused to
   * persist it. Null = storage holds the truth. Wrapped so a pref whose
   * values include null/undefined still works.
   */
  let unpersisted: { value: T } | null = null;

  function read(storage: Storage, k: string): T | undefined {
    const raw = storage.getItem(k);
    return raw === null ? undefined : parse(raw);
  }

  function load(): T {
    if (typeof window === 'undefined') return fallback;
    if (unpersisted) return unpersisted.value;
    try {
      const storage = window.localStorage;
      const current = read(storage, key);
      if (current !== undefined) return current;
      if (legacyKey) {
        const legacy = read(storage, legacyKey);
        if (legacy !== undefined) {
          const raw = serialise(legacy);
          if (raw !== null) storage.setItem(key, raw);
          storage.removeItem(legacyKey);
          return legacy;
        }
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  function save(value: T): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = serialise(value);
      if (raw === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, raw);
      unpersisted = null;
    } catch {
      // storage unavailable (private mode) or full — honour the choice
      // in memory for this page; the in-page state still applies
      unpersisted = { value };
    }
    window.dispatchEvent(new Event(event));
  }

  return {
    key,
    event,
    fallback,
    load,
    save,
    resetForTests: () => {
      unpersisted = null;
    },
  };
}
