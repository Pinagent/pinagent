// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the migration-tracking behaviour of `agent-runner`'s custom
 * drizzle migrator. Two guarantees:
 *
 *   - **Storage format:** fresh DBs record `sha256(rawSql)` (not
 *     `entry.tag`) in `__drizzle_migrations.hash`, so the browser-side
 *     mirror in `@pinagent/widget/src/db/migrations.ts` and the
 *     `/__pinagent/db-migrations` middleware endpoint
 *     (`vite-plugin/src/middleware.ts`, `next-plugin/src/route.ts`)
 *     stay byte-interoperable with what stock drizzle writes.
 *   - **Applied check:** the migrator decides "already applied?" by the
 *     `created_at` watermark (like drizzle itself), NOT by matching the
 *     `hash` value. That keeps it robust across writers: DBs from
 *     drizzle's stock migrator, and DBs from an earlier Pinagent build
 *     that wrote the migration *tag* into the `hash` column, are both
 *     recognised as already migrated. Keying on the hash value instead
 *     re-runs `CREATE TABLE`s on those DBs every dev-server start and
 *     explodes with `table … already exists` (which 500s every
 *     `POST /__pinagent/feedback`).
 *
 * The regression these guard against is silent: the mismatch surfaces
 * only on a non-empty DB, so unit tests against fresh tmp dirs alone
 * won't catch it.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = join(__dirname, '..', '..', 'db', 'drizzle');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

async function readJournal(): Promise<JournalEntry[]> {
  const text = await readFile(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8');
  const j = JSON.parse(text) as { entries: JournalEntry[] };
  return j.entries.slice().sort((a, b) => a.idx - b.idx);
}

async function sha256OfMigration(tag: string): Promise<string> {
  const sql = await readFile(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');
  return createHash('sha256').update(sql).digest('hex');
}

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `pa-db-migrator-${nanoid(8)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('db client migrator', () => {
  it('stores migrations keyed by sha256(rawSql), not entry.tag', async () => {
    // Smoke run on a fresh DB.
    getDb(root);

    const raw = new DatabaseSync(join(root, '.pinagent', 'db.sqlite'));
    const rows = raw.prepare('SELECT hash FROM __drizzle_migrations ORDER BY id').all() as {
      hash: string;
    }[];
    raw.close();

    const journal = await readJournal();
    expect(rows).toHaveLength(journal.length);

    // sha256 hex is exactly 64 lowercase hex chars. `entry.tag` is a
    // short snake-case slug (`0001_lazy_jimmy_woo`) — guarding by
    // shape catches a revert to either tag-keyed tracking or any
    // other hash algorithm with a different output width.
    for (const { hash } of rows) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    }

    // And each hash must equal sha256 of the corresponding .sql file.
    for (let i = 0; i < journal.length; i++) {
      const entry = journal[i] as JournalEntry;
      const expected = await sha256OfMigration(entry.tag);
      expect(rows[i]?.hash).toBe(expected);
    }
  });

  it('does not re-run migrations already present in a stock-drizzle DB', async () => {
    // Build a DB the way drizzle's stock migrator would leave it:
    // every migration's SQL applied, with sha256(rawSql) recorded in
    // `__drizzle_migrations`. Then ask agent-runner to open it. If
    // the migrator looked up by `entry.tag` (or any other key that
    // doesn't match what stock-drizzle wrote), the next `CREATE
    // TABLE` would throw `table … already exists`.
    const pinDir = join(root, '.pinagent');
    await mkdir(pinDir, { recursive: true });
    const dbPath = join(pinDir, 'db.sqlite');

    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA foreign_keys = ON');
    raw.exec(
      `CREATE TABLE __drizzle_migrations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         hash TEXT NOT NULL,
         created_at NUMERIC
       )`,
    );
    const insert = raw.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
    const journal = await readJournal();
    for (const entry of journal) {
      const sql = await readFile(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');
      const statements = sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) raw.exec(stmt);
      const hash = createHash('sha256').update(sql).digest('hex');
      insert.run(hash, entry.when);
    }
    raw.close();

    // The bug we guard against would surface as a synchronous throw
    // from the embedded `runMigrations` call inside getDb.
    expect(() => getDb(root)).not.toThrow();

    // And the `__drizzle_migrations` row count must be unchanged —
    // no migration ran a second time.
    const verify = new DatabaseSync(dbPath);
    const { count } = verify
      .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
      .get() as { count: number };
    verify.close();
    expect(count).toBe(journal.length);
  });

  it('does not re-run migrations recorded by a legacy tag-era build', async () => {
    // Reproduce a DB created by an earlier Pinagent build whose
    // migrator wrote the migration *tag* into the `hash` column
    // (`run(entry.tag, entry.when)`) instead of sha256(rawSql). Every
    // migration's SQL is applied and a tag-keyed row recorded. A
    // migrator that keys on the hash *value* sees none of these as
    // applied and re-runs migration 0000 → `table active_runs already
    // exists`, which is exactly the 500 reported on a real upgrade.
    const pinDir = join(root, '.pinagent');
    await mkdir(pinDir, { recursive: true });
    const dbPath = join(pinDir, 'db.sqlite');

    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA foreign_keys = ON');
    raw.exec(
      `CREATE TABLE __drizzle_migrations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         hash TEXT NOT NULL,
         created_at NUMERIC
       )`,
    );
    const insert = raw.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
    const journal = await readJournal();
    for (const entry of journal) {
      const sql = await readFile(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');
      const statements = sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) raw.exec(stmt);
      // The legacy footgun: tag in the hash column, not sha256.
      insert.run(entry.tag, entry.when);
    }
    raw.close();

    expect(() => getDb(root)).not.toThrow();

    const verify = new DatabaseSync(dbPath);
    const { count } = verify
      .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
      .get() as { count: number };
    verify.close();
    // No migration ran a second time, so no new tracking rows.
    expect(count).toBe(journal.length);
  });

  it('finishes a partially-migrated legacy tag-era DB without re-running applied ones', async () => {
    // The real-world upgrade case: an older build applied only the
    // first few migrations (and recorded them tag-keyed), then the user
    // upgraded to a build with more migrations. The migrator must skip
    // the already-applied ones (no `table … already exists`) AND apply
    // the remaining ones so the schema ends up complete.
    const journal = await readJournal();
    expect(journal.length).toBeGreaterThan(1); // need a tail to apply

    const pinDir = join(root, '.pinagent');
    await mkdir(pinDir, { recursive: true });
    const dbPath = join(pinDir, 'db.sqlite');

    const applied = journal.slice(0, 1); // only migration 0000 applied
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA foreign_keys = ON');
    raw.exec(
      `CREATE TABLE __drizzle_migrations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         hash TEXT NOT NULL,
         created_at NUMERIC
       )`,
    );
    const insert = raw.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
    for (const entry of applied) {
      const sql = await readFile(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');
      const statements = sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) raw.exec(stmt);
      insert.run(entry.tag, entry.when); // legacy tag-keyed row
    }
    raw.close();

    expect(() => getDb(root)).not.toThrow();

    // Every migration is now tracked, and the tail was applied with
    // sha256 hashes (the forward-compatible format).
    const verify = new DatabaseSync(dbPath);
    const rows = verify
      .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at')
      .all() as { hash: string; created_at: number }[];
    verify.close();
    expect(rows).toHaveLength(journal.length);
    for (let i = 1; i < journal.length; i++) {
      const entry = journal[i] as JournalEntry;
      expect(rows[i]?.hash).toBe(await sha256OfMigration(entry.tag));
    }
  });
});
