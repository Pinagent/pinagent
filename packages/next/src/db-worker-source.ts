/**
 * Source for the browser-side sqlite worker. Served verbatim at
 * `/__pinpoint/db-worker.js`; the widget spawns it with
 * `new Worker(url, { type: 'module' })`.
 *
 * Architecture choice: we install the **OPFS SAH Pool VFS**, not the
 * basic `opfs` VFS. The basic one only auto-registers when the page
 * is cross-origin-isolated (COOP/COEP), which Next dev doesn't set
 * by default — that's why the upstream `sqlite3-worker1-bundler-
 * friendly` worker logs "no such vfs: opfs" in our environment.
 *
 * The SAH Pool VFS uses `FileSystemSyncAccessHandle` (Worker-only,
 * but no COOP/COEP needed) for synchronous reads/writes against
 * OPFS. Persistence survives reload. If even SAH is unavailable
 * (very old browsers), we fall back to `:memory:` so the cache
 * stays functional, just not persistent.
 *
 * Protocol (simpler than the upstream worker1 wrapper):
 *
 *   client → worker
 *     { id, type: 'init', args: { dbName?: string } }
 *     { id, type: 'exec', args: { sql, bind?: any[] } }
 *
 *   worker → client
 *     { type: 'ready' }                              // sent once at startup
 *     { id, ok: true }                               // init / exec with no rows
 *     { id, ok: true, rows: any[][] }                // exec with results
 *     { id, ok: false, error: string }               // any failure
 */
export const DB_WORKER_SOURCE = `
// Drop sqlite-wasm's noisy "Ignoring inability to install OPFS
// sqlite3_vfs: Missing SharedArrayBuffer..." warning. That warning
// is about the BASIC opfs VFS (which needs COOP/COEP); we
// deliberately use the SAH Pool VFS instead, which has neither
// requirement.
{
  const origWarn = console.warn;
  console.warn = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Ignoring inability to install OPFS')
    ) {
      return;
    }
    origWarn.apply(console, args);
  };
}

import sqlite3InitModule from '/__pinpoint/sqlite-wasm/sqlite3-bundler-friendly.mjs';

let db = null;

async function init(args) {
  const sqlite3 = await sqlite3InitModule({
    print: () => {},
    printErr: (...a) => console.error('[pinpoint:sqlite-worker]', ...a),
  });

  // SAH Pool: persistent OPFS without COOP/COEP. initialCapacity 4
  // is enough for our DB + journal + a couple of temp files without
  // growing the pool on every open.
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({
      name: 'pinpoint',
      initialCapacity: 4,
    });
    db = new pool.OpfsSAHPoolDb(args && args.dbName ? args.dbName : 'pinpoint.sqlite');
    console.log('[pinpoint:sqlite-worker] backend: OPFS SAH Pool (persistent)');
  } catch (err) {
    console.warn('[pinpoint:sqlite-worker] backend: :memory: (no persistence) — SAH install failed:', err);
    db = new sqlite3.oo1.DB(':memory:');
  }
}

self.addEventListener('message', async (e) => {
  const { id, type, args } = e.data || {};
  try {
    if (type === 'init') {
      await init(args);
      self.postMessage({ id, ok: true });
      return;
    }
    if (type === 'exec') {
      if (!db) throw new Error('not initialised');
      const rows = [];
      db.exec({
        sql: args.sql,
        bind: args.bind || [],
        rowMode: 'array',
        resultRows: rows,
      });
      self.postMessage({ id, ok: true, rows });
      return;
    }
    throw new Error('unknown type: ' + type);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
});

self.postMessage({ type: 'ready' });
`;
