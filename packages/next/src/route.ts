import { Buffer } from 'node:buffer';
import { nanoid } from 'nanoid';
import { WIDGET_SOURCE } from './__generated__/widget';
import { resolveAgentMode, spawnAgent } from './agent';
import { openInEditor } from './editor';
import { FeedbackInputSchema, ID_RE, PatchSchema, Storage } from './storage';

// These exports exist here for type clarity, but consumers MUST re-declare them
// inline in their own route file — Next 16 statically parses route-segment
// config and refuses to follow re-exports for `dynamic` / `runtime`.
//
// Your `app/pinpoint/[[...slug]]/route.ts` should look like:
//
//   export const dynamic = 'force-dynamic';
//   export const runtime = 'nodejs';
//   export { GET, POST, PATCH } from '@pinpoint/next/route';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 8 * 1024 * 1024;

interface RouteCtx {
  params: Promise<{ slug?: string[] }> | { slug?: string[] };
}

function getStorage(): Storage {
  // PINPOINT_PROJECT_ROOT lets a turborepo target a specific app root.
  const root = process.env.PINPOINT_PROJECT_ROOT ?? process.cwd();
  return new Storage(root);
}

async function readSlug(ctx: RouteCtx): Promise<string[]> {
  const p = await Promise.resolve(ctx.params);
  return p.slug ?? [];
}

export async function GET(_req: Request, ctx: RouteCtx): Promise<Response> {
  const slug = await readSlug(ctx);

  // /__pinpoint/widget.js
  if (slug.length === 1 && slug[0] === 'widget.js') {
    return new Response(WIDGET_SOURCE, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const storage = getStorage();

  // /__pinpoint/feedback
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

  // /__pinpoint/feedback/:id
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

  // /__pinpoint/open — spawn the developer's editor at file:line:col.
  if (slug.length === 1 && slug[0] === 'open') {
    const url = new URL(req.url);
    const file = url.searchParams.get('file');
    const lineRaw = url.searchParams.get('line');
    const colRaw = url.searchParams.get('col');
    if (!file) return json(400, { error: 'file required' });
    try {
      const root = process.env.PINPOINT_PROJECT_ROOT ?? process.cwd();
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

  // Optionally spawn an isolated agent (worktree or inline). Fires and forgets;
  // the agent runs detached and writes its own log file. If env var isn't set,
  // this is a cheap no-op.
  const mode = resolveAgentMode(process.env);
  const agentSpawned = mode !== false;
  if (agentSpawned) {
    spawnAgent({ projectRoot: storage.root, feedback: rec, mode }).catch(() => {
      // Swallow — errors land in the per-feedback log.
    });
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
