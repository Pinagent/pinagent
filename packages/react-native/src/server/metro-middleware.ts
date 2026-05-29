// SPDX-License-Identifier: Apache-2.0
/**
 * Metro dev-server adapter for Pinagent.
 *
 * This is a near-copy of the `POST /__pinagent/feedback` arm of
 * `packages/vite-plugin/src/middleware.ts`. It reuses the existing
 * backend verbatim — `Storage` (writes to `.pinagent/db.sqlite` +
 * screenshots), `FeedbackInputSchema` (the wire contract), and
 * `spawnAgent` (inline / worktree agent runs). Nothing about agent
 * pickup is RN-specific; only the route mounting differs.
 *
 * Wire it in `metro.config.js`:
 *
 *   const { pinagentMiddleware } = require('@pinagent/react-native/server');
 *   module.exports = {
 *     server: {
 *       enhanceMiddleware: (metroMiddleware, server) =>
 *         pinagentMiddleware({ projectRoot: __dirname }).chain(metroMiddleware),
 *     },
 *   };
 *
 * `.chain(next)` returns a single connect handler that runs our routes
 * first and defers everything else to Metro's own middleware.
 */
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FeedbackInputSchema,
  type SpawnAgentMode,
  Storage,
  spawnAgent,
} from '@pinagent/agent-runner';
import { nanoid } from 'nanoid';

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8MB raw JSON (screenshot dominates)

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export interface PinagentMiddlewareOpts {
  /** Project root — where `.pinagent/` lives. Pass `__dirname`. */
  projectRoot: string;
  /**
   * Agent spawn mode, same semantics as the Vite plugin:
   * `false` (file only), `'inline'`, or `'worktree'`. Defaults to
   * `'inline'`.
   */
  spawnMode?: SpawnAgentMode;
}

export interface PinagentMiddleware {
  (req: IncomingMessage, res: ServerResponse, next: () => void): void;
  /** Compose: run pinagent routes first, then `next` for everything else. */
  chain(next: Handler): Handler;
}

export function pinagentMiddleware(opts: PinagentMiddlewareOpts): PinagentMiddleware {
  const storage = new Storage(opts.projectRoot);
  const spawnMode: SpawnAgentMode = opts.spawnMode ?? 'inline';

  const handler = (async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? '';
    if (!url.startsWith('/__pinagent')) return next();

    try {
      // POST /__pinagent/feedback — identical contract to the web plugins.
      if (req.method === 'POST' && url === '/__pinagent/feedback') {
        const raw = await readJsonBody(req);
        const parsed = FeedbackInputSchema.safeParse(raw);
        if (!parsed.success) return badRequest(res, parsed.error.message);

        const decoded = Buffer.from(parsed.data.screenshot, 'base64');
        if (decoded.length > 5 * 1024 * 1024) {
          return badRequest(res, 'screenshot exceeds 5MB');
        }

        const id = nanoid(10);
        const rec = await storage.create(id, parsed.data);

        const agentSpawned = spawnMode !== false;
        if (agentSpawned) {
          try {
            await spawnAgent({ projectRoot: storage.root, feedback: rec, mode: spawnMode });
          } catch {
            // Surfaces in the per-feedback log; don't fail the POST.
          }
        }
        return json(res, 200, { id: rec.id, agentSpawned });
      }

      // GET /__pinagent/feedback — list (handy for a future RN inbox view).
      if (req.method === 'GET' && url === '/__pinagent/feedback') {
        const items = await storage.list();
        return json(res, 200, items);
      }

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }) as unknown as PinagentMiddleware;

  handler.chain = (nextMw: Handler): Handler => {
    return (req, res, next) => {
      if ((req.url ?? '').startsWith('/__pinagent')) {
        handler(req, res, () => nextMw(req, res, next));
      } else {
        nextMw(req, res, next);
      }
    };
  };

  return handler;
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
      if (chunks.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
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
