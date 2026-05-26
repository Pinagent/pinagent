// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for the browser-side migration runner.
 *
 * The goal is byte-compatibility with drizzle's own server migrator
 * (`drizzle-orm/better-sqlite3/migrator`): same `__drizzle_migrations`
 * table shape, same hash, same `created_at` semantics. The tests run
 * both runners against in-memory SQLite DBs and diff the result.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';
import { applyMigrations, type ExecCall, type MigrationEntry } from '../src/db/migrations';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(THIS_DIR, '..', '..', 'next', 'drizzle');

/**
 * Wrap a `better-sqlite3` handle in the worker's `call` API shape so
 * we can drive `applyMigrations` exactly as it'll be driven in the
 * browser, just synchronously through the native binding.
 */
function makeCall(raw: Database.Database): ExecCall {
  return async (_type, args) => {
    const stmt = raw.prepare(args.sql);
    const params = (args.bind ?? []) as unknown[];
    const trimmed = args.sql.trim().toLowerCase();
    if (
      trimmed.startsWith('select') ||
      trimmed.startsWith('pragma') ||
      trimmed.startsWith('with')
    ) {
      const rows = (stmt as { raw(): { all(...p: unknown[]): unknown[][] } }).raw().all(...params);
      return { ok: true, rows };
    }
    stmt.run(...params);
    return { ok: true, rows: [] };
  };
}

/**
 * Synthesize the migration payload our route handler would send the
 * browser. Same fields, same hash, same order as drizzle's
 * `readMigrationFiles` so we can diff cleanly.
 */
function loadJournalMigrations(): MigrationEntry[] {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { idx: number; when: number; tag: string }[] };
  return journal.entries.map((entry) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    return { tag: entry.tag, when: entry.when, hash, sql };
  });
}

interface TrackingRow {
  id: number;
  hash: string;
  created_at: number;
}

function readTracking(raw: Database.Database): TrackingRow[] {
  return raw
    .prepare('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id ASC')
    .all() as TrackingRow[];
}

describe('drizzle migration compatibility', () => {
  it('hash matches drizzle.readMigrationFiles', () => {
    const ours = loadJournalMigrations();
    const theirs = readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });
    expect(ours.length).toBe(theirs.length);
    for (let i = 0; i < ours.length; i++) {
      // Hash: full-file sha256 hex (same as drizzle).
      expect(ours[i]!.hash).toBe(theirs[i]!.hash);
      // `when` we ship == drizzle's `folderMillis`.
      expect(ours[i]!.when).toBe(theirs[i]!.folderMillis);
    }
  });

  it('applyMigrations on fresh DB writes the same __drizzle_migrations rows as drizzle.migrate', async () => {
    const migrations = loadJournalMigrations();

    // Reference DB driven by drizzle's own migrator.
    const refRaw = new Database(':memory:');
    refRaw.pragma('foreign_keys = ON');
    drizzleMigrate(drizzle(refRaw), { migrationsFolder: MIGRATIONS_DIR });
    const refRows = readTracking(refRaw);

    // Our DB driven by the browser code under test.
    const ourRaw = new Database(':memory:');
    ourRaw.pragma('foreign_keys = ON');
    await applyMigrations(makeCall(ourRaw), migrations);
    const ourRows = readTracking(ourRaw);

    // Same number of rows.
    expect(ourRows.length).toBe(refRows.length);
    // Same hash + created_at, same order.
    for (let i = 0; i < ourRows.length; i++) {
      expect(ourRows[i]!.hash).toBe(refRows[i]!.hash);
      expect(Number(ourRows[i]!.created_at)).toBe(Number(refRows[i]!.created_at));
    }

    // Same schema. Compare CREATE TABLE statements from sqlite_master.
    const schemaSql = (db: Database.Database) =>
      db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string; sql: string }[];
    expect(schemaSql(ourRaw)).toEqual(schemaSql(refRaw));

    refRaw.close();
    ourRaw.close();
  });

  it('applyMigrations is idempotent — running twice leaves only one row per migration', async () => {
    const migrations = loadJournalMigrations();
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    await applyMigrations(makeCall(raw), migrations);
    const before = readTracking(raw);
    await applyMigrations(makeCall(raw), migrations);
    const after = readTracking(raw);
    expect(after.length).toBe(before.length);
    expect(after).toEqual(before);
    raw.close();
  });

  it('backfills pre-tracking DBs without re-running DDL', async () => {
    const migrations = loadJournalMigrations();
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');

    // Simulate a pre-tracking OPFS DB: apply all the DDL by hand,
    // skipping the tracking table. (drizzle-kit's `CREATE TABLE`
    // would fail on re-run — we're verifying applyMigrations doesn't
    // attempt it.)
    for (const m of migrations) {
      const statements = m.sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) raw.exec(stmt);
    }

    // No __drizzle_migrations yet.
    const masterBefore = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
      .all();
    expect(masterBefore.length).toBe(0);

    // applyMigrations should detect the schema, create the table, and
    // backfill — NOT re-run any DDL (which would throw).
    await applyMigrations(makeCall(raw), migrations);

    const rows = readTracking(raw);
    expect(rows.length).toBe(migrations.length);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i]!.hash).toBe(migrations[i]!.hash);
      expect(Number(rows[i]!.created_at)).toBe(migrations[i]!.when);
    }
    raw.close();
  });

  it('applies new migrations on top of an already-tracked DB', async () => {
    const migrations = loadJournalMigrations();
    // Pretend only the first migration has been applied.
    const partial = migrations.slice(0, 1);
    const raw = new Database(':memory:');
    raw.pragma('foreign_keys = ON');
    await applyMigrations(makeCall(raw), partial);
    expect(readTracking(raw).length).toBe(1);

    // Now hand over the full list. The runner should skip #0 (already
    // applied) and run #1.
    await applyMigrations(makeCall(raw), migrations);
    const final = readTracking(raw);
    expect(final.length).toBe(migrations.length);
    for (let i = 0; i < final.length; i++) {
      expect(final[i]!.hash).toBe(migrations[i]!.hash);
      expect(Number(final[i]!.created_at)).toBe(migrations[i]!.when);
    }
    raw.close();
  });

  it('table shape matches drizzle (id SERIAL PK, hash TEXT NOT NULL, created_at NUMERIC)', async () => {
    // Drizzle reference DB.
    const refRaw = new Database(':memory:');
    drizzleMigrate(drizzle(refRaw), { migrationsFolder: MIGRATIONS_DIR });

    // Ours.
    const ourRaw = new Database(':memory:');
    await applyMigrations(makeCall(ourRaw), []);

    const cols = (db: Database.Database) =>
      db.prepare('PRAGMA table_info(__drizzle_migrations)').all() as {
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }[];

    expect(cols(ourRaw)).toEqual(cols(refRaw));

    // And the CREATE TABLE text stored in sqlite_master matches drizzle byte-for-byte.
    const ddl = (db: Database.Database) =>
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
        .get() as { sql: string };
    expect(ddl(ourRaw).sql).toBe(ddl(refRaw).sql);

    refRaw.close();
    ourRaw.close();
  });
});
