// SPDX-License-Identifier: Apache-2.0
//
// Suppress Node's ExperimentalWarning for `node:sqlite`. The module is
// stable in Node 22.13+ (and we require 22.18+), but the warning text
// hasn't been removed yet. Filter it out before the first import below
// so users / CI don't see the noise. Other warnings still pass through.
{
  // biome-ignore lint/suspicious/noExplicitAny: process.emit's overloaded variadic signature defeats narrower typing here.
  const proc = process as any;
  const originalEmit = proc.emit.bind(proc);
  // biome-ignore lint/suspicious/noExplicitAny: same.
  proc.emit = (event: string | symbol, ...args: any[]): boolean => {
    if (event === 'warning') {
      const warning = args[0];
      if (
        warning instanceof Error &&
        warning.name === 'ExperimentalWarning' &&
        warning.message.startsWith('SQLite is an experimental feature')
      ) {
        return false;
      }
    }
    return originalEmit(event, ...args);
  };
}

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import * as schema from '@pinagent/db/schema';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';

export type Db = SqliteRemoteDatabase<typeof schema>;

/**
 * One Drizzle handle per dev process, keyed by project root so a
 * monorepo with multiple Pinagent-enabled apps gets distinct DBs.
 *
 * Storage is per-process and held on a globalThis Symbol so Next 16's
 * route module re-evaluations don't open the same DB file twice. The
 * underlying node:sqlite handle is cheap to keep open for the lifetime
 * of `next dev`.
 *
 * We use Node's built-in `node:sqlite` (stable since Node 22.13) rather
 * than `better-sqlite3` to avoid the native-build install step (pnpm
 * 10+ blocks postinstall by default; users were hitting
 * `Could not locate the bindings file` after fresh installs). Same
 * underlying SQLite engine, same on-disk format — no data migration.
 *
 * `drizzle-orm/sqlite-proxy` is the right adapter shape: it takes a
 * callback that executes SQL against any backend. We thread node:sqlite
 * synchronous calls through it. Drizzle exposes an async API to
 * consumers but our storage layer already `await`s everything, so call
 * sites are unchanged.
 */
const SINGLETON_KEY = Symbol.for('pinagent.db');

interface GlobalHolder {
  [SINGLETON_KEY]?: Map<string, { db: Db; raw: DatabaseSync }>;
}

// Migrations are generated in `packages/db/drizzle/` (the source of
// truth — next to the schema they're derived from). At publish time
// each framework adapter's `scripts/copy-drizzle.mjs` mirrors them
// into the adapter's own `drizzle/` tree so they ship in the npm
// tarball. agent-runner is bundled into the adapter's dist, so the
// first candidate below covers the published-tarball runtime; the
// remaining ones cover the in-monorepo dev/test layout where this
// file runs from packages/agent-runner/{dist,src}/db/client.ts.
const moduleUrl: string | undefined = import.meta.url;
const MIGRATIONS_DIR = (() => {
  const base = moduleUrl ? dirname(fileURLToPath(moduleUrl)) : __dirname;
  const candidates = [
    // Bundled into next-plugin / vite-plugin: <plugin>/dist/route.{js,cjs} → ../drizzle.
    resolve(base, '..', 'drizzle'),
    // agent-runner's own dist (consumers importing @pinagent/agent-runner directly):
    // packages/agent-runner/dist/index.{js,cjs} → ../../db/drizzle.
    resolve(base, '..', '..', 'db', 'drizzle'),
    // agent-runner source (tests, ts-node): packages/agent-runner/src/db/client.ts →
    // packages/db/drizzle.
    resolve(base, '..', '..', '..', 'db', 'drizzle'),
  ];
  // Check for the journal file specifically, not just the directory.
  // An empty `drizzle/` dir (e.g. left behind by a partial prebuild)
  // would otherwise short-circuit the fallback and fail at migrate().
  return candidates.find((p) => existsSync(resolve(p, 'meta', '_journal.json'))) ?? candidates[0]!;
})();

/**
 * Wrap a `node:sqlite` DatabaseSync in the drizzle-orm/sqlite-proxy
 * callback shape. `method` distinguishes 'run' (no rows expected,
 * returns changes / lastInsertRowid) from 'all' / 'get' / 'values'
 * (rows). The proxy callback is declared async; we just call the sync
 * primitives and return synchronously — Drizzle awaits the result.
 */
function makeDrizzle(raw: DatabaseSync): Db {
  return drizzle(
    async (sql, params, method) => {
      const stmt = raw.prepare(sql);
      if (method === 'run') {
        const info = stmt.run(...(params as (string | number | bigint | Uint8Array | null)[]));
        return {
          rows: [
            {
              changes: Number(info.changes),
              lastInsertRowid: info.lastInsertRowid,
            },
          ],
        };
      }
      const rows = stmt.all(
        ...(params as (string | number | bigint | Uint8Array | null)[]),
      ) as Record<string, unknown>[];
      // sqlite-proxy expects rows as arrays of column values, not
      // objects. Project each row through the column-name order
      // returned by `stmt.columns()`.
      const columns = stmt.columns().map((c) => c.column ?? c.name);
      const projected = rows.map((r) => columns.map((c) => r[c as string] ?? null));
      if (method === 'get') return { rows: projected[0] ?? [] };
      return { rows: projected };
    },
    { schema },
  );
}

/**
 * Apply every `.sql` migration in journal order. Replaces
 * `drizzle-orm/better-sqlite3/migrator` (which is bound to the
 * better-sqlite3 driver) with a tiny equivalent that drives node:sqlite
 * directly. Mirrors the browser-side migrator pattern in
 * `packages/widget/src/db/migrations.ts`.
 */
function runMigrations(raw: DatabaseSync, migrationsDir: string): void {
  const journalPath = join(migrationsDir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[pinagent:db] no migrations dir at ${migrationsDir}; skipping migrate(). Run \`pnpm --filter @pinagent/db drizzle:gen\` to generate.`,
    );
    return;
  }

  // Decide "already applied?" by the `created_at` watermark, exactly
  // like drizzle's own migrator (and the browser-side mirror in
  // `@pinagent/widget/src/db/migrations.ts`): the highest recorded
  // `created_at` is the high-water mark, and any journal entry whose
  // `when` is at or below it is already applied.
  //
  // We deliberately do NOT key off the `hash` *value* in the tracking
  // table. Earlier Pinagent builds wrote the migration *tag*
  // (`0000_fast_swarm`) into the `hash` column instead of
  // `sha256(rawSql)`; a build keying on hash membership treats every
  // one of those legacy rows as unknown, re-runs migration 0000, and
  // crashes on `CREATE TABLE active_runs … already exists` — which
  // 500s every `POST /__pinagent/feedback`. `created_at` is identical
  // across all three writers (stock drizzle, the tag-era build, and
  // this one — all store the journal `when`), so the watermark is
  // robust to the format drift. We still *write* sha256 going forward
  // to stay byte-compatible with stock drizzle and the browser mirror.
  raw.exec(
    `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       hash TEXT NOT NULL,
       created_at NUMERIC
     )`,
  );

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; when: number; tag: string }[];
  };
  const sortedEntries = journal.entries.slice().sort((a, b) => a.idx - b.idx);

  const hashOf = (entry: { tag: string }): string => {
    const sql = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
    return createHash('sha256').update(sql).digest('hex');
  };
  const insert = raw.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');

  const lastRow = raw
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
    .get() as { created_at: number | null } | undefined;
  let lastWhen = lastRow?.created_at != null ? Number(lastRow.created_at) : null;

  // Backfill: a pre-tracking DB has the schema but an empty tracking
  // table (e.g. one created before the tracking table existed). Probe
  // for `conversations` — the first table migration 0000 creates — and
  // if it's there, record every known migration as applied rather than
  // re-running their `CREATE TABLE`s. Mirrors the browser-side migrator.
  if (lastWhen == null && sortedEntries.length > 0) {
    const probe = raw
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversations'")
      .get();
    if (probe) {
      for (const entry of sortedEntries) {
        insert.run(hashOf(entry), entry.when);
      }
      return;
    }
  }

  for (const entry of sortedEntries) {
    if (lastWhen != null && lastWhen >= entry.when) continue;
    const sql = readFileSync(join(migrationsDir, `${entry.tag}.sql`), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      raw.exec(stmt);
    }
    insert.run(createHash('sha256').update(sql).digest('hex'), entry.when);
    lastWhen = entry.when;
  }
}

export function getDb(projectRoot: string): Db {
  const g = globalThis as GlobalHolder;
  if (!g[SINGLETON_KEY]) g[SINGLETON_KEY] = new Map();
  const cache = g[SINGLETON_KEY];
  const root = resolve(projectRoot);
  const existing = cache.get(root);
  if (existing) return existing.db;

  const dbPath = join(root, '.pinagent', 'db.sqlite');
  mkdirSync(dirname(dbPath), { recursive: true });

  const raw = new DatabaseSync(dbPath);
  // WAL gives concurrent readers (the eventual MCP server, the dev
  // server, agent processes) without serialising on writes. Default
  // (rollback journal) blocks all readers while the writer holds the
  // file. Cheap to enable, expensive to wish for later.
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');

  runMigrations(raw, MIGRATIONS_DIR);

  const db = makeDrizzle(raw);
  cache.set(root, { db, raw });
  return db;
}

export { schema };

/**
 * Walk `migrationsDir` even if it's not the discovered MIGRATIONS_DIR
 * — useful for the test helper or anything that wants to verify the
 * migrator picks up new SQL files. Re-exported for symmetry with the
 * old better-sqlite3 migrator's standalone export.
 */
export function applyMigrations(raw: DatabaseSync, migrationsDir: string): void {
  runMigrations(raw, migrationsDir);
}

// Allow consumers (and the test suite) to confirm the underlying
// engine when they need to bypass the Drizzle proxy. We keep this
// narrow on purpose — the proxy is the supported interface.
export function readdirSorted(p: string): string[] {
  return readdirSync(p).sort();
}
