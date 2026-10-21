/**
 * The Cloudflare bindings the sync worker touches, over Node builtins, so
 * the REAL worker code runs in vitest: D1 over node:sqlite (the same
 * shim worker-sync / worker-analytics carry inline) and the slice of R2
 * the unlock routes use, over a Map.
 */
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');
export type SqliteDatabase = InstanceType<typeof DatabaseSync>;

export function openSqlite(): SqliteDatabase {
  return new DatabaseSync(':memory:');
}

export interface BoundStmt {
  bind(...values: unknown[]): BoundStmt;
  all<T>(): Promise<{ results: T[] }>;
  runNow(): void;
}

export function makeD1(db: SqliteDatabase) {
  const prepare = (sql: string): BoundStmt => {
    let params: unknown[] = [];
    const stmt: BoundStmt = {
      bind(...values: unknown[]) {
        params = values;
        return stmt;
      },
      async all<T>() {
        const results = db.prepare(sql).all(...(params as never[])) as T[];
        return { results };
      },
      runNow() {
        db.prepare(sql).run(...(params as never[]));
      },
    };
    return stmt;
  };
  return {
    prepare,
    async batch(statements: BoundStmt[]) {
      for (const s of statements) s.runNow();
      return [];
    },
  };
}

export function makeR2() {
  const objects = new Map<string, { text: string; customMetadata: Record<string, string> }>();
  return {
    objects,
    async head(key: string) {
      const o = objects.get(key);
      return o ? { customMetadata: o.customMetadata } : null;
    },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { customMetadata: o.customMetadata, text: async () => o.text } : null;
    },
    async put(key: string, value: string, options?: { customMetadata?: Record<string, string> }) {
      const o = { text: value, customMetadata: options?.customMetadata ?? {} };
      objects.set(key, o);
      return { customMetadata: o.customMetadata };
    },
  };
}
