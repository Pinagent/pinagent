// SPDX-License-Identifier: Apache-2.0
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ComposeOptsSchema,
  composePullRequest,
  FeedbackInputSchema,
  getChangeDiff,
  ID_RE,
  listBranches,
  listChanges,
  openInEditor,
  PatchSchema,
  type SpawnAgentMode,
  type Storage,
  spawnAgent,
} from '@pinagent/agent-runner';
import { DB_WORKER_SOURCE } from '@pinagent/browser-runtime';
import { nanoid } from 'nanoid';
import type { Connect } from 'vite';
import { WIDGET_SOURCE } from './__generated__/widget';

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8MB raw JSON (screenshot dominates)

interface CreateMiddlewareOpts {
  storage: Storage;
  /** Resolved spawn mode for this dev server. */
  spawnMode: SpawnAgentMode;
  /** WebSocket port the widget should connect to. */
  wsPort: number | null;
  /**
   * When true, the middleware serves the @pinagent/widget-dock static
   * assets from /__pinagent/dock/*. Disabled by default — see the
   * `dock` option in `PinagentOptions`.
   */
  dock: boolean;
}

export function createMiddleware(opts: CreateMiddlewareOpts): Connect.NextHandleFunction {
  const { storage, spawnMode, wsPort, dock } = opts;

  return async function pinagentMiddleware(req, res, next) {
    const url = req.url ?? '';
    if (!url.startsWith('/__pinagent')) return next();

    try {
      // GET /__pinagent/dock/<path> — dock static assets (only when opted in).
      // Strips query strings (Vite's HMR adds ?v=hash to asset requests).
      const dockMatch =
        dock && req.method === 'GET' && /^\/__pinagent\/dock(?:\/(.*?))?(?:\?.*)?$/.exec(url);
      if (dockMatch) {
        const file = dockMatch[1] && dockMatch[1].length > 0 ? dockMatch[1] : 'index.html';
        return serveDockFile(res, file);
      }

      // GET /__pinagent/widget.js — IIFE bundle + a prelude that hands the
      // widget its dynamic config (WS URL today). Mirrors `buildWidgetBundle`
      // in next-plugin/route.ts.
      if (req.method === 'GET' && url === '/__pinagent/widget.js') {
        const bundle = buildWidgetBundle(wsPort);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(bundle);
        return;
      }

      // GET /__pinagent/db-worker.js — sqlite-wasm worker source (browser-runtime).
      if (req.method === 'GET' && url === '/__pinagent/db-worker.js') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(DB_WORKER_SOURCE);
        return;
      }

      // GET /__pinagent/db-migrations — drizzle migration journal + SQL.
      if (req.method === 'GET' && url === '/__pinagent/db-migrations') {
        const payload = await serveDbMigrations();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(payload);
        return;
      }

      // GET /__pinagent/sqlite-wasm/<file> — proxy sqlite-wasm jswasm files.
      const wasmMatch = req.method === 'GET' && /^\/__pinagent\/sqlite-wasm\/([^/]+)$/.exec(url);
      if (wasmMatch) {
        return serveSqliteWasm(res, wasmMatch[1] ?? '');
      }

      // POST /__pinagent/open — spawn the developer's editor at file:line:col.
      if (req.method === 'POST' && url.startsWith('/__pinagent/open')) {
        const parsedUrl = new URL(url, 'http://localhost');
        const file = parsedUrl.searchParams.get('file');
        const lineRaw = parsedUrl.searchParams.get('line');
        const colRaw = parsedUrl.searchParams.get('col');
        if (!file) return badRequest(res, 'file required');
        try {
          const result = await openInEditor(
            storage.root,
            file,
            lineRaw ? Number(lineRaw) : undefined,
            colRaw ? Number(colRaw) : undefined,
          );
          return json(res, 200, result);
        } catch (e) {
          return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      }

      // POST /__pinagent/feedback
      if (req.method === 'POST' && url === '/__pinagent/feedback') {
        const raw = await readJsonBody(req);
        const parsed = FeedbackInputSchema.safeParse(raw);
        if (!parsed.success) {
          return badRequest(res, parsed.error.message);
        }
        const decoded = Buffer.from(parsed.data.screenshot, 'base64');
        if (decoded.length > 5 * 1024 * 1024) {
          return badRequest(res, 'screenshot exceeds 5MB');
        }
        const id = nanoid(10);
        const rec = await storage.create(id, parsed.data);

        // Mirror next-plugin/route.ts: optionally spawn an isolated agent.
        // `await` so the widget's first WS subscribe sees `worktreeState`
        // already set to `active` (or stays at `none` for inline mode).
        const agentSpawned = spawnMode !== false;
        if (agentSpawned) {
          try {
            await spawnAgent({ projectRoot: storage.root, feedback: rec, mode: spawnMode });
          } catch {
            // Errors land in the per-feedback log; don't fail the POST.
          }
        }

        return json(res, 200, { id: rec.id, agentSpawned });
      }

      // GET /__pinagent/changes — per-conversation diff stats for the
      // dock's Changes view. Walks every conversation with a worktree
      // and runs `git diff --shortstat` against the project HEAD.
      if (req.method === 'GET' && url === '/__pinagent/changes') {
        const changes = await listChanges(storage.root);
        return json(res, 200, changes);
      }

      // GET /__pinagent/changes/:id/diff — full unified diff for one
      // conversation's worktree. Lazily called when the dock's Changes
      // row is expanded; capped server-side (see computeWorktreeDiff).
      const diffMatch = req.method === 'GET' && /^\/__pinagent\/changes\/([^/]+)\/diff$/.exec(url);
      if (diffMatch) {
        const id = diffMatch[1] ?? '';
        if (!ID_RE.test(id)) return badRequest(res, 'invalid id');
        const result = await getChangeDiff(storage.root, id);
        if (!result) return notFound(res);
        return json(res, 200, result);
      }

      // GET /__pinagent/branches — every conversation with an active or
      // landed worktree, plus its git cleanliness state + disk usage.
      // Drives the dock's Branches view.
      if (req.method === 'GET' && url === '/__pinagent/branches') {
        const branches = await listBranches(storage.root);
        return json(res, 200, branches);
      }

      // POST /__pinagent/prs — compose a PR from multiple conversations.
      // Bundles the selected worktrees onto a fresh branch in a throwaway
      // worktree, pushes, and (if GITHUB_TOKEN is set + origin is GitHub)
      // opens the PR. Returns prUrl, branchPushed, manualCompareUrl, or
      // error per ComposeResult.
      if (req.method === 'POST' && url === '/__pinagent/prs') {
        const raw = await readJsonBody(req);
        const parsed = ComposeOptsSchema.safeParse(raw);
        if (!parsed.success) return badRequest(res, parsed.error.message);
        const result = await composePullRequest(storage.root, parsed.data);
        return json(res, result.ok ? 200 : 422, result);
      }

      // GET /__pinagent/feedback
      if (req.method === 'GET' && url === '/__pinagent/feedback') {
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
        return json(res, 200, shallow);
      }

      // GET /__pinagent/feedback/:id
      const getMatch = req.method === 'GET' && /^\/__pinagent\/feedback\/([^/]+)$/.exec(url);
      if (getMatch) {
        const id = getMatch[1] ?? '';
        if (!ID_RE.test(id)) return badRequest(res, 'invalid id');
        const rec = await storage.read(id);
        if (!rec) return notFound(res);
        const screenshot = await storage.readScreenshotBase64(rec);
        return json(res, 200, { ...rec, screenshot });
      }

      // PATCH /__pinagent/feedback/:id
      const patchMatch = req.method === 'PATCH' && /^\/__pinagent\/feedback\/([^/]+)$/.exec(url);
      if (patchMatch) {
        const id = patchMatch[1] ?? '';
        if (!ID_RE.test(id)) return badRequest(res, 'invalid id');
        const raw = await readJsonBody(req);
        const parsed = PatchSchema.safeParse(raw);
        if (!parsed.success) return badRequest(res, parsed.error.message);
        const rec = await storage.patch(id, parsed.data);
        if (!rec) return notFound(res);
        return json(res, 200, rec);
      }

      return notFound(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json(res, 500, { error: msg });
    }
  };
}

/**
 * Build the widget IIFE plus a prelude that hands the widget its config
 * (currently just the WebSocket URL). Mirrors `buildWidgetBundle` in
 * `packages/next-plugin/src/route.ts`.
 */
function buildWidgetBundle(wsPort: number | null): string {
  const config = wsPort ? { wsUrl: `ws://127.0.0.1:${wsPort}/__pinagent/ws` } : { wsUrl: null };
  const prelude = `;(function(){try{window.__pinagentConfig=${JSON.stringify(config)};}catch(e){}})();\n`;
  return prelude + WIDGET_SOURCE;
}

/**
 * Whitelist of sqlite-wasm files we expose. Mirrors next-plugin/route.ts.
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
  const req = createRequire(import.meta.url ?? `file://${process.cwd()}/__pinagent__.js`);
  const pkgJson = req.resolve('@sqlite.org/sqlite-wasm/package.json');
  sqliteWasmDirCache = join(dirname(pkgJson), 'sqlite-wasm', 'jswasm');
  return sqliteWasmDirCache;
}

/**
 * Resolve @pinagent/widget-dock's dist directory at runtime. The dock
 * package is a runtime dep of @pinagent/vite-plugin, so its package.json
 * is reachable via require.resolve regardless of how the consumer
 * installed pinagent. Cached after first call.
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

async function serveDockFile(res: ServerResponse, requested: string): Promise<void> {
  const distDir = dockDistDir();
  if (!distDir) {
    // The dock package isn't installed alongside the plugin. This
    // happens if `dock: true` is set but the consumer didn't install
    // @pinagent/widget-dock — log a helpful hint and 404.
    // eslint-disable-next-line no-console
    console.error('[pinagent] dock: true was set but @pinagent/widget-dock could not be resolved.');
    res.statusCode = 404;
    res.end();
    return;
  }
  // Normalize and clamp the requested path inside distDir to block any
  // `..`-style traversal even though the URL pattern already restricts
  // it — defense in depth.
  const safeRel = requested.replace(/^\/+/, '').replace(/\.\.\/?/g, '');
  const abs = join(distDir, safeRel);
  if (!abs.startsWith(distDir)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase();
  const mime = DOCK_MIME_BY_EXT[ext] ?? 'application/octet-stream';
  try {
    const bytes = await readFile(abs);
    res.statusCode = 200;
    res.setHeader('Content-Type', mime);
    // Dev assets — fonts can cache for the session but mark JS/CSS as
    // no-store so HMR-style reloads pick up rebuilds.
    res.setHeader(
      'Cache-Control',
      ext === '.woff2' || ext === '.woff' ? 'public, max-age=86400' : 'no-store',
    );
    res.end(bytes);
  } catch {
    res.statusCode = 404;
    res.end();
  }
}

async function serveSqliteWasm(res: ServerResponse, file: string): Promise<void> {
  const mime = SQLITE_WASM_FILES[file];
  if (!mime) {
    res.statusCode = 404;
    res.end();
    return;
  }
  try {
    const bytes = await readFile(join(sqliteWasmDir(), file));
    res.statusCode = 200;
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.end(bytes);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[pinagent] failed to serve sqlite-wasm/${file}:`, e);
    res.statusCode = 500;
    res.end();
  }
}

/**
 * Read drizzle-kit migrations + journal and emit drizzle's
 * `readMigrationFiles`-compatible payload. Mirrors next-plugin/route.ts.
 */
async function serveDbMigrations(): Promise<string> {
  // Path-walker mirrors agent-runner/src/db/client.ts and the same
  // fallback in next-plugin/src/route.ts: first candidate is the
  // published-tarball layout (drizzle/ sibling to dist/ after the
  // copy-drizzle prebuild). Fall back to packages/db/drizzle/ for
  // in-monorepo dev where the consumer's prebuild hasn't run.
  const moduleUrl: string | undefined = import.meta.url;
  const base = moduleUrl ? dirname(fileURLToPath(moduleUrl)) : process.cwd();
  const candidates = [
    // packages/vite-plugin/{dist,src}/middleware.{js,cjs,ts} → ../drizzle (sibling)
    join(base, '..', 'drizzle'),
    // packages/vite-plugin/src/middleware.ts (no prebuild yet) → packages/db/drizzle
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
    return JSON.stringify({ migrations });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[pinagent] failed to serve db-migrations:', e);
    return JSON.stringify({ migrations: [] });
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function badRequest(res: ServerResponse, msg: string): void {
  json(res, 400, { error: msg });
}

function notFound(res: ServerResponse): void {
  json(res, 404, { error: 'not found' });
}
