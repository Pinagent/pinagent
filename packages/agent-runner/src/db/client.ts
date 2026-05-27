// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '@pinagent/db/schema';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * One Drizzle handle per dev process, keyed by project root so a
 * monorepo with multiple Pinagent-enabled apps gets distinct DBs.
 *
 * Storage is per-process and held on a globalThis Symbol so Next 16's
 * route module re-evaluations don't open the same DB file twice. The
 * underlying better-sqlite3 handle is cheap to keep open for the
 * lifetime of `next dev`.
 */
const SINGLETON_KEY = Symbol.for('pinagent.db');

interface GlobalHolder {
  [SINGLETON_KEY]?: Map<string, Db>;
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

export function getDb(projectRoot: string): Db {
  const g = globalThis as GlobalHolder;
  if (!g[SINGLETON_KEY]) g[SINGLETON_KEY] = new Map();
  const cache = g[SINGLETON_KEY];
  const root = resolve(projectRoot);
  const existing = cache.get(root);
  if (existing) return existing;

  const dbPath = join(root, '.pinagent', 'db.sqlite');
  mkdirSync(dirname(dbPath), { recursive: true });

  const raw = new Database(dbPath);
  // WAL gives concurrent readers (the eventual MCP server, the dev
  // server, agent processes) without serialising on writes. Default
  // (rollback journal) blocks all readers while the writer holds the
  // file. Cheap to enable, expensive to wish for later.
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  const db = drizzle(raw, { schema });

  if (existsSync(MIGRATIONS_DIR)) {
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    // First-run convenience for development: if migrations haven't
    // been generated yet, push the schema directly. Not safe for prod
    // (no down-migration story) but fine for the dev-only DB.
    // eslint-disable-next-line no-console
    console.warn(
      `[pinagent:db] no migrations dir at ${MIGRATIONS_DIR}; skipping migrate(). Run \`pnpm --filter @pinagent/db drizzle:gen\` to generate.`,
    );
  }

  cache.set(root, db);
  return db;
}

export { schema };
