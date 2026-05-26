// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '@pinagent/db/schema';
import Database from 'better-sqlite3';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';

/**
 * In-memory better-sqlite3 wrapped in a drizzle/sqlite-proxy adapter
 * — same Drizzle DB type the browser uses, so tests exercise the
 * exact write/read code paths (`packages/widget/src/db/writes.ts`,
 * `packages/widget/src/db/reads.ts`) without bringing up sqlite-wasm.
 *
 * Applies every `.sql` file from `packages/next/drizzle/` in order so
 * the schema mirrors what the dev server runs.
 */
export type TestDb = SqliteRemoteDatabase<typeof schema>;

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(THIS_DIR, '..', '..', '..', 'next', 'drizzle');

export function openTestDb(): { db: TestDb; close: () => void } {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith('.sql'))
    .sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      raw.exec(stmt);
    }
  }

  // sqlite-proxy callback: forward each query to better-sqlite3.
  // `method` distinguishes 'run' (no result read) from 'all' / 'get'
  // / 'values' (rows expected). We use `.raw()` so result rows come
  // back as arrays — drizzle reshapes them per the schema.
  const db = drizzle(
    async (sql, params, method) => {
      const stmt = raw.prepare(sql);
      if (method === 'run') {
        const info = stmt.run(...(params as never[]));
        return {
          rows: [
            {
              changes: info.changes,
              lastInsertRowid: info.lastInsertRowid,
            },
          ],
        };
      }
      const rows = stmt.raw().all(...(params as never[])) as unknown[][];
      if (method === 'get') return { rows: rows[0] ?? [] };
      return { rows };
    },
    { schema },
  );

  return {
    db: db as TestDb,
    close: () => raw.close(),
  };
}
