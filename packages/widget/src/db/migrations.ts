/**
 * Browser-side migration runner. Byte-compatible with drizzle's own
 * server-side `migrate()` (see `drizzle-orm/sqlite-core/dialect.js`):
 *
 *   - Tracking table:
 *       __drizzle_migrations (
 *         id INTEGER PRIMARY KEY,
 *         hash text NOT NULL,
 *         created_at numeric
 *       )
 *   - For each journal entry, decide "already applied" by comparing
 *     the highest `created_at` against `migration.when`.
 *   - Apply by running each `--> statement-breakpoint`-separated chunk
 *     of SQL, then inserting `(hash, when)`.
 *
 * Mirroring this exactly means the browser's `__drizzle_migrations`
 * is interchangeable with what a server-side `migrate(db, ...)` would
 * write — so if we ever want to share a single DB across server and
 * browser, the tracking already lines up.
 *
 * The one place we diverge: drizzle's server migrator wraps the apply
 * loop in BEGIN/COMMIT. We can't, because our worker RPC is one
 * round-trip per statement and SQLite's BEGIN holds a write lock for
 * the duration. The cost is partial-progress recovery: if a migration
 * crashes mid-run, the table records every statement that ran but the
 * migration row isn't inserted, so the next run will retry the
 * already-applied statements and fail on "duplicate" errors. We
 * accept that — migrations should be small enough that this is rare.
 */

/**
 * Drizzle-format migration entry — what the dev-server hands us at
 * `/__pinagent/db-migrations` after reading `meta/_journal.json` +
 * the per-entry `.sql` files.
 */
export interface MigrationEntry {
  /** Journal `tag` — filename without `.sql`. Not stored, just for debug. */
  tag: string;
  /** Journal `when` (folderMillis) — stored as `created_at`. */
  when: number;
  /** sha256(rawSql) hex — stored as `hash`. */
  hash: string;
  /** Raw .sql file contents. Split on drizzle's `--> statement-breakpoint`. */
  sql: string;
}

/**
 * Callback shape matching the widget worker's RPC. Returns `rows` as
 * an array of array of cell values (rowMode: 'array').
 */
export type ExecCall = (
  type: 'exec',
  args: { sql: string; bind?: unknown[] },
) => Promise<{ ok: boolean; rows?: unknown[][] }>;

// Whitespace + identifier-quoting matters: SQLite stores the
// post-parse CREATE TABLE text in sqlite_master, and we want
// `SELECT sql FROM sqlite_master` to come back byte-identical to
// what drizzle's server-side migrator produced. So this string
// matches `drizzle-orm/sqlite-core/dialect.js` SQLiteSyncDialect.migrate
// exactly — tabs and all. `SERIAL` is interpreted by SQLite as a
// type name with integer affinity; combined with PRIMARY KEY it
// makes the column an alias for rowid (auto-incrementing).
const TRACKING_TABLE_DDL =
  'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (\n' +
  '\t\t\t\tid SERIAL PRIMARY KEY,\n' +
  '\t\t\t\thash text NOT NULL,\n' +
  '\t\t\t\tcreated_at numeric\n' +
  '\t\t\t)';

export async function applyMigrations(call: ExecCall, migrations: MigrationEntry[]): Promise<void> {
  await call('exec', { sql: TRACKING_TABLE_DDL });

  const lastRes = await call('exec', {
    sql: 'SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1',
  });
  const lastRows = (lastRes.rows as unknown[][] | undefined) ?? [];
  let lastWhen = lastRows.length > 0 ? Number(lastRows[0]?.[2]) : null;

  // Backfill: pre-tracking OPFS DBs have the schema but no tracking
  // table. Detect by probing for `conversations` (the first table
  // migration 0000 creates). If it's there and we have nothing
  // applied, insert all known migrations as already-done — same hash
  // and `when` that a fresh `migrate()` would have written.
  if (lastWhen == null && migrations.length > 0) {
    const probe = await call('exec', {
      sql: "SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversations'",
    });
    const probeRows = (probe.rows as unknown[][] | undefined) ?? [];
    if (probeRows.length > 0) {
      for (const m of migrations) {
        await call('exec', {
          sql: 'INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)',
          bind: [m.hash, m.when],
        });
      }
      lastWhen = migrations[migrations.length - 1]?.when ?? null;
    }
  }

  for (const m of migrations) {
    if (lastWhen != null && lastWhen >= m.when) continue;
    const statements = m.sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await call('exec', { sql: stmt });
    }
    await call('exec', {
      sql: 'INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)',
      bind: [m.hash, m.when],
    });
    lastWhen = m.when;
  }
}
