// SPDX-License-Identifier: Apache-2.0
import type { IncomingMessage, ServerResponse } from 'node:http';
import { nanoid } from 'nanoid';
import type { Connect } from 'vite';
import { WIDGET_SOURCE } from './__generated__/widget';
import type { AutoTrigger } from './auto-trigger';
import { FeedbackInputSchema, ID_RE, PatchSchema, type Storage } from './storage';

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8MB raw JSON (screenshot dominates)

export function createMiddleware(
  storage: Storage,
  autoTrigger: AutoTrigger | null,
): Connect.NextHandleFunction {
  return async function pinagentMiddleware(req, res, next) {
    const url = req.url ?? '';
    if (!url.startsWith('/__pinagent')) return next();

    try {
      // GET /__pinagent/widget.js
      if (req.method === 'GET' && url === '/__pinagent/widget.js') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(WIDGET_SOURCE);
        return;
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
        if (autoTrigger) {
          autoTrigger.enqueue({ id: rec.id, comment: rec.comment, file: rec.file });
        }
        return json(res, 200, { id: rec.id });
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
