// SPDX-License-Identifier: Apache-2.0
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FeedbackInputSchema,
  ID_RE,
  openInEditor,
  PatchSchema,
  resolveAgentMode,
  Storage,
  spawnAgent,
  startWsServer,
} from '@pinagent/agent-runner';
import { DB_WORKER_SOURCE } from '@pinagent/browser-runtime';
import { nanoid } from 'nanoid';
import { WIDGET_SOURCE } from './__generated__/widget';

// Boot the WebSocket server in this module — same process as spawnAgent and
// the event bus. Starting it from next.config.ts would put it in a different
// process, so the bus that the route handler publishes to would not be the
// bus that WS subscribers read from.
//
// Singleton-guarded inside startWsServer so HMR / multiple route imports
// don't try to bind the same port twice.
if (process.env.NODE_ENV !== 'production' && resolveAgentMode(process.env) !== false) {
  if (!process.env.PINAGENT_WS_PORT) process.env.PINAGENT_WS_PORT = '53636';
  try {
    startWsServer();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[pinagent] failed to start WebSocket server:', err);
  }
}

// These exports exist here for type clarity, but consumers MUST re-declare them
// inline in their own route file — Next 16 statically parses route-segment
// config and refuses to follow re-exports for `dynamic` / `runtime`.
//
// Your `app/pinagent/[[...slug]]/route.ts` should look like:
//
//   export const dynamic = 'force-dynamic';
//   export const runtime = 'nodejs';
//   export { GET, POST, PATCH } from '@pinagent/next-plugin/route';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 8 * 1024 * 1024;

interface RouteCtx {
  params: Promise<{ slug?: string[] }> | { slug?: string[] };
}

function getStorage(): Storage {
  // PINAGENT_PROJECT_ROOT lets a turborepo target a specific app root.
  const root = process.env.PINAGENT_PROJECT_ROOT ?? process.cwd();
  return new Storage(root);
}

async function readSlug(ctx: RouteCtx): Promise<string[]> {
  const p = await Promise.resolve(ctx.params);
  return p.slug ?? [];
}

export async function GET(_req: Request, ctx: RouteCtx): Promise<Response> {
  const slug = await readSlug(ctx);

  // /__pinagent/widget.js
  if (slug.length === 1 && slug[0] === 'widget.js') {
    return new Response(buildWidgetBundle(), {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  // /__pinagent/sqlite-wasm/<file> — proxies the sqlite-wasm jswasm
  // directory so the browser can spawn the Worker + load the WASM. We
  // serve directly out of node_modules rather than copying into dist
  // because the files are big (~1.5MB total) and only used in dev.
  if (slug.length === 2 && slug[0] === 'sqlite-wasm') {
    return serveSqliteWasm(slug[1] ?? '');
  }

  // /__pinagent/db-migrations — concatenated migration SQL for the
  // browser cache. Same DDL the server runs on .pinagent/db.sqlite.
  if (slug.length === 1 && slug[0] === 'db-migrations') {
    return serveDbMigrations();
  }

  // /__pinagent/db-worker.js — our own sqlite-wasm worker. Installs
  // the OPFS SAH Pool VFS so persistence works without COOP/COEP.
  if (slug.length === 1 && slug[0] === 'db-worker.js') {
    return new Response(DB_WORKER_SOURCE, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const storage = getStorage();

  // /__pinagent/feedback
  if (slug.length === 1 && slug[0] === 'feedback') {
    const items = await storage.list();
    const shallow = items.map((r) => ({
      id: r.id,
      comment: r.comment,
      file: r.file,
      line: r.line,
      col: r.col,
      selector: r.selector,
      url: r.url,
      status: r.status,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    }));
    return json(200, shallow);
  }

  // /__pinagent/feedback/:id
  if (slug.length === 2 && slug[0] === 'feedback') {
    const id = slug[1] ?? '';
    if (!ID_RE.test(id)) return json(400, { error: 'invalid id' });
    const rec = await storage.read(id);
    if (!rec) return json(404, { error: 'not found' });
    const screenshot = await storage.readScreenshotBase64(rec);
    return json(200, { ...rec, screenshot });
  }

  return json(404, { error: 'not found' });
}

export async function POST(req: Request, ctx: RouteCtx): Promise<Response> {
  const slug = await readSlug(ctx);

  // /__pinagent/open — spawn the developer's editor at file:line:col.
  if (slug.length === 1 && slug[0] === 'open') {
    const url = new URL(req.url);
    const file = url.searchParams.get('file');
    const lineRaw = url.searchParams.get('line');
    const colRaw = url.searchParams.get('col');
    if (!file) return json(400, { error: 'file required' });
    try {
      const root = process.env.PINAGENT_PROJECT_ROOT ?? process.cwd();
      const result = await openInEditor(
        root,
        file,
        lineRaw ? Number(lineRaw) : undefined,
        colRaw ? Number(colRaw) : undefined,
      );
      return json(200, result);
    } catch (e) {
      return json(500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (slug.length !== 1 || slug[0] !== 'feedback') {
    return json(404, { error: 'not found' });
  }

  const raw = await readJsonBody(req);
  const parsed = FeedbackInputSchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: parsed.error.message });

  const decoded = Buffer.from(parsed.data.screenshot, 'base64');
  if (decoded.length > 5 * 1024 * 1024) {
    return json(400, { error: 'screenshot exceeds 5MB' });
  }

  const id = nanoid(10);
  const storage = getStorage();
  const rec = await storage.create(id, parsed.data);

  // Optionally spawn an isolated agent (worktree or inline). `spawnAgent`
  // returns once the worktree exists (or immediately in inline mode); the
  // actual SDK run is fire-and-forget inside. We `await` here so the
  // widget's first `subscribe` sees `worktreeState='active'` instead of
  // racing the worktree creation.
  const mode = resolveAgentMode(process.env);
  const agentSpawned = mode !== false;
  if (agentSpawned) {
    try {
      await spawnAgent({ projectRoot: storage.root, feedback: rec, mode });
    } catch {
      // Swallow — errors land in the per-feedback log.
    }
  }

  return json(200, { id: rec.id, agentSpawned });
}

export async function PATCH(req: Request, ctx: RouteCtx): Promise<Response> {
  const slug = await readSlug(ctx);
  if (slug.length !== 2 || slug[0] !== 'feedback') {
    return json(404, { error: 'not found' });
  }
  const id = slug[1] ?? '';
  if (!ID_RE.test(id)) return json(400, { error: 'invalid id' });

  const raw = await readJsonBody(req);
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: parsed.error.message });

  const rec = await getStorage().patch(id, parsed.data);
  if (!rec) return json(404, { error: 'not found' });
  return json(200, rec);
}

/**
 * Build the widget IIFE plus a small prelude that hands the widget the
 * dynamic config it needs at runtime (currently just the WebSocket URL).
 *
 * The widget reads `window.__pinagentConfig` on mount. If unset, it falls
 * back to a default port — but that fallback only succeeds when running
 * against the same machine on the standard port, so we always inject.
 */
function buildWidgetBundle(): string {
  const wsPort = process.env.PINAGENT_WS_PORT;
  const config = wsPort
    ? { wsUrl: `ws://${defaultWsHost()}:${wsPort}/__pinagent/ws` }
    : { wsUrl: null };
  const prelude = `;(function(){try{window.__pinagentConfig=${JSON.stringify(config)};}catch(e){}})();\n`;
  return prelude + WIDGET_SOURCE;
}

/**
 * Whitelist of sqlite-wasm files we expose. Locked-down so a path
 * traversal can't read arbitrary files out of node_modules.
 */
const SQLITE_WASM_FILES: Record<string, string> = {
  'sqlite3-bundler-friendly.mjs': 'application/javascript; charset=utf-8',
  'sqlite3-worker1-bundler-friendly.mjs': 'application/javascript; charset=utf-8',
  'sqlite3-opfs-async-proxy.js': 'application/javascript; charset=utf-8',
  'sqlite3.mjs': 'application/javascript; charset=utf-8',
  'sqlite3.js': 'application/javascript; charset=utf-8',
  'sqlite3.wasm': 'application/wasm',
};

let sqliteWasmDirCache: string | null = null;
function sqliteWasmDir(): string {
  if (sqliteWasmDirCache) return sqliteWasmDirCache;
  // createRequire so we resolve from this module's own location,
  // independent of cwd, and let pnpm's symlinks find the real path.
  const req = createRequire(import.meta.url ?? `file://${process.cwd()}/__pinagent__.js`);
  const pkgJson = req.resolve('@sqlite.org/sqlite-wasm/package.json');
  sqliteWasmDirCache = join(dirname(pkgJson), 'sqlite-wasm', 'jswasm');
  return sqliteWasmDirCache;
}

async function serveSqliteWasm(file: string): Promise<Response> {
  const mime = SQLITE_WASM_FILES[file];
  if (!mime) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(join(sqliteWasmDir(), file));
    // The bundler-friendly worker references its sibling files via
    // import.meta.url, so cross-origin isolation isn't strictly needed
    // — but COOP/COEP helps if a user later switches to the basic
    // OpfsDb VFS. Cheap to set, so we set it.
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'no-store',
        // Allow this Worker to be loaded as a module from the page.
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[pinagent] failed to serve sqlite-wasm/${file}:`, e);
    return new Response(null, { status: 500 });
  }
}

/**
 * Read drizzle-kit migrations + journal and emit a payload that's
 * byte-compatible with drizzle's own `readMigrationFiles`:
 *   - tag: journal entry's `tag` (filename without `.sql`)
 *   - when: journal entry's `when` (folderMillis)
 *   - hash: sha256 of the raw .sql file content (hex)
 *   - sql:  the raw .sql file
 *
 * Drizzle's server migrator uses (hash, when) as the row written to
 * `__drizzle_migrations` and decides "already applied" by comparing
 * the highest `created_at` against `when`. Matching here means the
 * browser's tracking table is interchangeable with what a server-side
 * `migrate()` would write.
 */
async function serveDbMigrations(): Promise<Response> {
  // Path-walker mirrors agent-runner/src/db/client.ts: the first
  // candidate is the published-tarball layout (drizzle/ sibling to
  // dist/ after the copy-drizzle prebuild). The remaining candidates
  // cover the in-monorepo dev/test layout where
  // packages/next-plugin/drizzle/ may not exist yet (it's only
  // populated by prebuild) — fall back to the single source of
  // truth at packages/db/drizzle/.
  const moduleUrl: string | undefined = import.meta.url;
  const base = moduleUrl ? dirname(fileURLToPath(moduleUrl)) : process.cwd();
  const candidates = [
    // packages/next-plugin/{dist,src}/route.{js,cjs,ts} → ../drizzle (sibling)
    join(base, '..', 'drizzle'),
    // packages/next-plugin/src/route.ts (no prebuild yet) → packages/db/drizzle
    join(base, '..', '..', 'db', 'drizzle'),
  ];
  // Check for the journal file specifically, not just the directory.
  // An empty `drizzle/` dir (e.g. left behind by a partial prebuild)
  // would otherwise short-circuit the fallback and fail at readFile.
  const dir =
    candidates.find((p) => existsSync(join(p, 'meta', '_journal.json'))) ?? candidates[0]!;
  try {
    const journalText = await readFile(join(dir, 'meta', '_journal.json'), 'utf8');
    const journal = JSON.parse(journalText) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const migrations = await Promise.all(
      journal.entries.map(async (entry) => {
        const sql = await readFile(join(dir, `${entry.tag}.sql`), 'utf8');
        const hash = createHash('sha256').update(sql).digest('hex');
        return { tag: entry.tag, when: entry.when, hash, sql };
      }),
    );
    return new Response(JSON.stringify({ migrations }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[pinagent] failed to serve db-migrations:', e);
    return new Response(JSON.stringify({ migrations: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

function defaultWsHost(): string {
  // 127.0.0.1 is safer than `localhost` (avoids IPv6/IPv4 resolution
  // mismatches that can cause silent connect failures on some setups).
  // Consumers running pinagent behind a tunnel/proxy can override the
  // bundle by handling the route themselves; that's a v3 concern.
  return '127.0.0.1';
}

async function readJsonBody(req: Request): Promise<unknown> {
  const ab = await req.arrayBuffer();
  if (ab.byteLength > MAX_BODY_BYTES) throw new Error('payload too large');
  if (ab.byteLength === 0) return null;
  const text = Buffer.from(ab).toString('utf8');
  return JSON.parse(text);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
