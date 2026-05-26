// SPDX-License-Identifier: Apache-2.0
import * as schema from '@pinagent/db/schema';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { applyMigrations, type MigrationEntry } from './migrations';
import { pruneOldConversations } from './writes';

/**
 * Browser-side SQLite cache.
 *
 * Architecture:
 *
 *   main thread (widget IIFE)                  Worker
 *   ─────────────────────────                  ──────
 *   initBrowserDb()                            sqlite3-worker1-bundler-friendly.mjs
 *     │                                          │ load sqlite3.wasm
 *     │ new Worker(...)                          │ register message handlers
 *     │                                          │
 *     │◄─── 'worker1-ready' ─────────────────────│
 *     │                                          │
 *     │── 'open' { filename: opfs:... } ───────► │ open OPFS-backed DB
 *     │◄── { dbId } ─────────────────────────────│
 *     │                                          │
 *     │── 'exec' { sql: <migration> } ─────────► │ apply migrations
 *     │◄── { ok } ───────────────────────────────│
 *     │                                          │
 *     │── 'exec' { sql, bind, rowMode: array } ► │ run query
 *     │◄── { resultRows: [[...]] } ──────────────│
 *
 *   The Drizzle `sqlite-proxy` adapter wraps the exec round-trip so
 *   `db.select().from(conversations).where(...)` works as it does on
 *   the server.
 *
 * Persistence: opfs:pinagent.sqlite via the bundler-friendly Worker.
 * If OPFS isn't available (Firefox in some configurations, Safari pre-17),
 * we fall back to `:memory:` — the cache is lost on reload but the UI
 * keeps working.
 *
 * Source-of-truth is still the server. Browser cache is a mirror —
 * see v2 plan §4.2.
 */

export type BrowserDb = SqliteRemoteDatabase<typeof schema>;

let dbInstance: BrowserDb | null = null;
let initPromise: Promise<BrowserDb> | null = null;

/**
 * Promises for worker calls that haven't completed yet. The widget
 * registers a `beforeunload` listener that awaits these so in-flight
 * writes get a chance to land on OPFS before the page tears down.
 *
 * Browsers don't actually await async work in `beforeunload`, so this
 * is best-effort: the moment the handler returns, navigation continues
 * regardless. In practice the pending postMessages have already been
 * queued — what we gain is the brief window where the worker can
 * drain them before being terminated.
 */
const outstandingCalls = new Set<Promise<unknown>>();

export function getBrowserDb(): BrowserDb | null {
  return dbInstance;
}

export async function flushBrowserDb(): Promise<void> {
  if (outstandingCalls.size === 0) return;
  await Promise.allSettled(Array.from(outstandingCalls));
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export async function initBrowserDb(): Promise<BrowserDb> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;
  initPromise = doInit();
  try {
    dbInstance = await initPromise;
    return dbInstance;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

async function doInit(): Promise<BrowserDb> {
  // Our own module worker (not the upstream worker1 wrapper). It
  // installs the OPFS SAH Pool VFS, which works without the COOP/COEP
  // headers the basic `opfs` VFS would need. Source lives in
  // packages/browser-runtime/src/db-worker-source.ts and is served at
  // /__pinagent/db-worker.js.
  const worker = new Worker('/__pinagent/db-worker.js', { type: 'module' });

  let nextMsgId = 0;
  const pending = new Map<number, PendingCall>();

  let readyResolve: (() => void) | null = null;
  const ready = new Promise<void>((r) => {
    readyResolve = r;
  });

  worker.addEventListener('message', (e) => {
    const msg = e.data as {
      type?: string;
      id?: number;
      ok?: boolean;
      error?: string;
      rows?: unknown[][];
    };
    if (msg.type === 'ready') {
      readyResolve?.();
      return;
    }
    if (typeof msg.id !== 'number') return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) {
      p.resolve(msg);
    } else {
      p.reject(new Error(msg.error ?? 'sqlite worker error'));
    }
  });

  worker.addEventListener('error', (e) => {
    // eslint-disable-next-line no-console
    console.error('[pinagent:db] worker error:', e.message);
  });

  function call(type: string, args: object): Promise<{ ok: boolean; rows?: unknown[][] }> {
    const id = ++nextMsgId;
    const promise = new Promise<{ ok: boolean; rows?: unknown[][] }>((resolve, reject) => {
      pending.set(id, { resolve: resolve as PendingCall['resolve'], reject });
      worker.postMessage({ id, type, args });
    });
    // Track for beforeunload flush. Reads + writes both — reads are
    // fast (SAH is synchronous) and Promise.allSettled doesn't care.
    //
    // Use .then(fn, fn) (not .finally) so the cleanup chain is fully
    // settled — a `.finally` chain re-throws on rejection and shows
    // up as "Uncaught (in promise)" even though the caller is
    // handling the original promise.
    outstandingCalls.add(promise);
    promise.then(
      () => outstandingCalls.delete(promise),
      () => outstandingCalls.delete(promise),
    );
    return promise;
  }

  await ready;
  await call('init', { dbName: 'pinagent.sqlite' });

  // Fetch + apply migrations. Refetched from the dev server rather
  // than bundled so the schema can't drift between server and browser
  // — they read the exact same DDL files.
  //
  // Applied migrations are tracked in a `__drizzle_migrations` table
  // (mirroring drizzle-kit's server-side convention) so we only run
  // each migration once. Without this, ALTER TABLE ADD COLUMN
  // re-runs would fail with "duplicate column name" — SQLite has no
  // `IF NOT EXISTS` for that statement.
  try {
    const res = await fetch('/__pinagent/db-migrations');
    if (res.ok) {
      const body = (await res.json()) as { migrations: MigrationEntry[] };
      await applyMigrations((type, args) => call(type, args as object), body.migrations);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pinagent:db] failed to apply migrations:', err);
  }

  // Drizzle sqlite-proxy adapter. Forwards each query to the worker.
  const db = drizzle(
    async (sql, params, method) => {
      const res = await call('exec', { sql, bind: params });
      const rows = res.rows ?? [];
      // For `get`, drizzle wants the first row only.
      if (method === 'get') return { rows: rows[0] ?? [] };
      return { rows };
    },
    { schema },
  );

  // One-shot LRU cleanup. Resolved conversations older than 30 days
  // get dropped (CASCADE takes their messages with them). Pending
  // conversations are spared regardless of age.
  try {
    const dropped = await pruneOldConversations(db);
    if (dropped > 0) {
      // eslint-disable-next-line no-console
      console.log(`[pinagent:db] pruned ${dropped} stale conversations`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pinagent:db] prune failed (non-fatal):', err);
  }

  return db;
}
