// SPDX-License-Identifier: Apache-2.0
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ComposeOptsSchema,
  composePullRequest,
  FeedbackInputSchema,
  getChangeDiff,
  type HistoryStatusFilter,
  ID_RE,
  listAuditEvents,
  listBranches,
  listChanges,
  listPullRequests,
  openInEditor,
  PatchSchema,
  ProjectSettingsPatchSchema,
  pruneBranch,
  pruneStaleBranches,
  resolveAgentMode,
  SecretsStore,
  SettingsStore,
  Storage,
  searchHistory,
  spawnAgent,
  startWsServer,
  validateAnthropicKey,
  validateGithubToken,
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
  // Fire-and-forget — the bind is async (we may need to fall back if 53636 is
  // held by a stale dev server from another project). On success, the
  // singleton mutates `process.env.PINAGENT_WS_PORT` to the actually-bound
  // port; the widget-bundle prelude (`buildWidgetBundle`) reads that env on
  // each request so the widget always learns the correct port — even when
  // the first widget.js request races the bind.
  startWsServer().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[pinagent] failed to start WebSocket server:', err);
  });
}

// These exports exist here for type clarity, but consumers MUST re-declare them
// inline in their own route file — Next 16 statically parses route-segment
// config and refuses to follow re-exports for `dynamic` / `runtime`.
//
// Your `app/pinagent/[[...slug]]/route.ts` should look like:
//
//   export const dynamic = 'force-dynamic';
//   export const runtime = 'nodejs';
//   export { GET, POST, PATCH, PUT, DELETE } from '@pinagent/next-plugin/route';
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

export async function GET(req: Request, ctx: RouteCtx): Promise<Response> {
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

  // /__pinagent/dock/<path> — dock static assets. Always served when
  // the dock package is installed; the `dock: true` opt-in just
  // controls whether the host page mounts the iframe (see component.tsx).
  // Bare /__pinagent/dock falls back to embedded.html (the production
  // iframe entry); the standalone build is loaded by the hosted
  // dashboard, not via this route.
  if (slug.length >= 1 && slug[0] === 'dock') {
    const file = slug.length > 1 ? slug.slice(1).join('/') : 'embedded.html';
    return serveDockFile(file);
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

  // /__pinagent/changes — per-conversation diff stats for the dock's
  // Changes view. Walks every conversation with a worktree and runs
  // `git diff --shortstat` against the project HEAD.
  if (slug.length === 1 && slug[0] === 'branches') {
    const branches = await listBranches(storage.root);
    return json(200, branches);
  }

  if (slug.length === 1 && slug[0] === 'changes') {
    const changes = await listChanges(storage.root);
    return json(200, changes);
  }

  // /__pinagent/prs — read mirror of PRs the compose flow has opened.
  // Mirror of the vite-plugin GET handler.
  if (slug.length === 1 && slug[0] === 'prs') {
    const prs = await listPullRequests(storage.root);
    return json(200, prs);
  }

  // /__pinagent/history?q=&status= — server-side full-text search over
  // resolved conversations. Empty q returns []; the dock falls back to
  // its client-side filter for "show all resolved".
  if (slug.length === 1 && slug[0] === 'history') {
    const url = new URL(req.url);
    const q = url.searchParams.get('q') ?? '';
    const statusParam = url.searchParams.get('status');
    const status: HistoryStatusFilter =
      statusParam === 'landed' || statusParam === 'discarded' ? statusParam : 'all';
    const hits = await searchHistory(storage.root, { query: q, status });
    return json(200, hits);
  }

  // /__pinagent/audit-log?limit=&offset=&conversationId= — feed of
  // agent + user actions, newest first. Backs the dock's History →
  // Activity tab.
  if (slug.length === 1 && slug[0] === 'audit-log') {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const conversationId = url.searchParams.get('conversationId') ?? undefined;
    const events = await listAuditEvents(storage.root, {
      limit: Number.isFinite(limit) ? limit : 100,
      offset: Number.isFinite(offset) ? offset : 0,
      ...(conversationId ? { conversationId } : {}),
    });
    return json(200, events);
  }

  // /__pinagent/changes/:id/diff — full unified diff for one
  // conversation's worktree. Lazily called when the Changes row is
  // expanded; capped server-side.
  if (slug.length === 3 && slug[0] === 'changes' && slug[2] === 'diff') {
    const id = slug[1] ?? '';
    if (!ID_RE.test(id)) return json(400, { error: 'invalid id' });
    const result = await getChangeDiff(storage.root, id);
    if (!result) return json(404, { error: 'not found' });
    return json(200, result);
  }

  // /__pinagent/connections — presentable connection state. Never
  // returns raw tokens; the dock's transport calls this and renders
  // off the presentable shape only.
  if (slug.length === 1 && slug[0] === 'connections') {
    const secrets = new SecretsStore(storage.root);
    return json(200, await secrets.presentable());
  }

  // /__pinagent/settings — current project config.
  if (slug.length === 1 && slug[0] === 'settings') {
    const settings = new SettingsStore(storage.root);
    return json(200, await settings.read());
  }

  // /__pinagent/feedback
  if (slug.length === 1 && slug[0] === 'feedback') {
    const items = await storage.list();
    // Keep this shallow projection in sync with `FeedbackRecordSchema`
    // in `@pinagent/widget-dock/transport/local.ts` — the dock zod-
    // parses the response and a missing field surfaces to users as
    // "Couldn't load conversations".
    const shallow = items.map((r) => ({
      id: r.id,
      comment: r.comment,
      file: r.file,
      line: r.line,
      col: r.col,
      selector: r.selector,
      url: r.url,
      status: r.status,
      worktreeState: r.worktreeState,
      branch: r.branch,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
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

  // /__pinagent/branches/prune-stale — bulk-prune worktrees older
  // than `worktreeRetentionDays` (read server-side from settings).
  if (slug.length === 2 && slug[0] === 'branches' && slug[1] === 'prune-stale') {
    const storage = getStorage();
    const result = await pruneStaleBranches(storage.root);
    return json(200, result);
  }

  // /__pinagent/prs — compose a PR from multiple conversations. See
  // composePullRequest for what happens server-side; the dock's
  // transport calls this exactly the same way it calls the vite-plugin
  // version.
  if (slug.length === 1 && slug[0] === 'prs') {
    const raw = await readJsonBody(req);
    const parsed = ComposeOptsSchema.safeParse(raw);
    if (!parsed.success) return json(400, { error: parsed.error.message });
    const storage = getStorage();
    const result = await composePullRequest(storage.root, parsed.data);
    return json(result.ok ? 200 : 422, result);
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

  // /__pinagent/settings — partial update.
  if (slug.length === 1 && slug[0] === 'settings') {
    const raw = await readJsonBody(req);
    const parsed = ProjectSettingsPatchSchema.safeParse(raw);
    if (!parsed.success) return json(400, { error: parsed.error.message });
    const settings = new SettingsStore(getStorage().root);
    return json(200, await settings.patch(parsed.data));
  }

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
 * PUT — connection set/replace. The two connection kinds (github,
 * anthropic) share the same shape: validate the credential upstream,
 * persist on success, surface the upstream error on failure.
 */
export async function PUT(req: Request, ctx: RouteCtx): Promise<Response> {
  const slug = await readSlug(ctx);
  if (slug.length !== 2 || slug[0] !== 'connections') {
    return json(404, { error: 'not found' });
  }
  const kind = slug[1];
  const storage = getStorage();
  const secrets = new SecretsStore(storage.root);

  if (kind === 'github') {
    const body = (await readJsonBody(req)) as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length === 0) {
      return json(400, { error: 'token required' });
    }
    const v = await validateGithubToken(body.token);
    if (!v.ok || !v.login) return json(422, { error: v.error ?? 'invalid token' });
    await secrets.setGithub(body.token, v.login);
    return json(200, await secrets.presentable());
  }
  if (kind === 'anthropic') {
    const body = (await readJsonBody(req)) as { key?: unknown };
    if (typeof body.key !== 'string' || body.key.length === 0) {
      return json(400, { error: 'key required' });
    }
    const v = await validateAnthropicKey(body.key);
    if (!v.ok) return json(422, { error: v.error ?? 'invalid key' });
    await secrets.setAnthropic(body.key);
    return json(200, await secrets.presentable());
  }
  return json(404, { error: 'not found' });
}

/** DELETE — connection clear + branch prune. */
export async function DELETE(_req: Request, ctx: RouteCtx): Promise<Response> {
  const slug = await readSlug(ctx);
  const storage = getStorage();

  // /__pinagent/branches/:id — prune one worktree.
  if (slug.length === 2 && slug[0] === 'branches') {
    const id = slug[1] ?? '';
    if (!ID_RE.test(id)) return json(400, { error: 'invalid id' });
    const result = await pruneBranch(storage.root, id);
    return json(result.ok ? 200 : 422, result);
  }

  if (slug.length !== 2 || slug[0] !== 'connections') {
    return json(404, { error: 'not found' });
  }
  const kind = slug[1];
  const secrets = new SecretsStore(storage.root);
  if (kind === 'github') {
    await secrets.clearGithub();
    return json(200, await secrets.presentable());
  }
  if (kind === 'anthropic') {
    await secrets.clearAnthropic();
    return json(200, await secrets.presentable());
  }
  return json(404, { error: 'not found' });
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

/**
 * Resolve @pinagent/widget-dock's dist directory at runtime. Mirrors
 * the vite-plugin's resolution pattern — the dock package is a runtime
 * dep of @pinagent/next-plugin, so its package.json is reachable via
 * require.resolve regardless of how the consumer installed pinagent.
 */
let dockDistDirCache: string | null = null;
function dockDistDir(): string | null {
  if (dockDistDirCache) return dockDistDirCache;
  try {
    const req = createRequire(import.meta.url ?? `file://${process.cwd()}/__pinagent__.js`);
    const pkgJson = req.resolve('@pinagent/widget-dock/package.json');
    dockDistDirCache = join(dirname(pkgJson), 'dist');
    return dockDistDirCache;
  } catch {
    return null;
  }
}

const DOCK_MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function serveDockFile(requested: string): Promise<Response> {
  const distDir = dockDistDir();
  if (!distDir) {
    // eslint-disable-next-line no-console
    console.error(
      '[pinagent] /__pinagent/dock/* requested but @pinagent/widget-dock is not installed.',
    );
    return new Response(null, { status: 404 });
  }
  // Strip leading slashes and any `..` segments — defense in depth even
  // though the slug-array shape already restricts what gets here.
  const safeRel = requested.replace(/^\/+/, '').replace(/\.\.\/?/g, '');
  const abs = join(distDir, safeRel);
  if (!abs.startsWith(distDir)) return new Response(null, { status: 404 });
  const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase();
  const mime = DOCK_MIME_BY_EXT[ext] ?? 'application/octet-stream';
  try {
    const bytes = await readFile(abs);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': ext === '.woff2' || ext === '.woff' ? 'public, max-age=86400' : 'no-store',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
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
