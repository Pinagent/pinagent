import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@pinpoint/db/schema';

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * One Drizzle handle per dev process, keyed by project root so a
 * monorepo with multiple Pinpoint-enabled apps gets distinct DBs.
 *
 * Storage is per-process and held on a globalThis Symbol so Next 16's
 * route module re-evaluations don't open the same DB file twice. The
 * underlying better-sqlite3 handle is cheap to keep open for the
 * lifetime of `next dev`.
 */
const SINGLETON_KEY = Symbol.for('pinpoint.db');

interface GlobalHolder {
  [SINGLETON_KEY]?: Map<string, Db>;
}

// Migrations live at `packages/next/drizzle/` (drizzle-kit's default
// `out` directory) and ship with the package via the `files` array in
// package.json. At runtime tsup-bundled output sits in `dist/`; walking
// up one directory from the bundled module lands at the package root.
// fileURLToPath + path.join (not `new URL(literal, ...)`) so Turbopack
// doesn't try to resolve the path as a bundleable asset at build time.
const moduleUrl: string | undefined = import.meta.url;
const MIGRATIONS_DIR = resolve(
  moduleUrl
    ? join(dirname(fileURLToPath(moduleUrl)), '..', 'drizzle')
    : join(__dirname, '..', 'drizzle'),
);

export function getDb(projectRoot: string): Db {
  const g = globalThis as GlobalHolder;
  if (!g[SINGLETON_KEY]) g[SINGLETON_KEY] = new Map();
  const cache = g[SINGLETON_KEY];
  const root = resolve(projectRoot);
  const existing = cache.get(root);
  if (existing) return existing;

  const dbPath = join(root, '.pinpoint', 'db.sqlite');
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
      `[pinpoint:db] no migrations dir at ${MIGRATIONS_DIR}; skipping migrate(). Run \`pnpm --filter @pinpoint/next drizzle:gen\` to generate.`,
    );
  }

  cache.set(root, db);
  return db;
}

export { schema };
