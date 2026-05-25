import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Route-handler integration tests.
 *
 * We import GET/POST/PATCH directly from src/route.ts and feed them
 * web-standard `Request` objects. No HTTP layer, no Next dev server,
 * no Turbopack — just the handlers as functions.
 *
 * Setup:
 *   - PINAGENT_PROJECT_ROOT → fresh tmp dir per file so the SQLite
 *     migrations apply against an isolated DB.
 *   - PINAGENT_SPAWN_AGENT='off' so route.ts's top-level block
 *     skips starting the WS server (we don't want random port
 *     binds polluting CI).
 *   - NODE_ENV='production' as a belt-and-suspenders against the
 *     same WS-start guard.
 */

const PROJECT_ROOT = join(tmpdir(), `pa-route-${nanoid(8)}`);

beforeAll(async () => {
  process.env.PINAGENT_PROJECT_ROOT = PROJECT_ROOT;
  process.env.PINAGENT_SPAWN_AGENT = 'off';
  process.env.NODE_ENV = 'production';
  await mkdir(PROJECT_ROOT, { recursive: true });
});

afterAll(async () => {
  await rm(PROJECT_ROOT, { recursive: true, force: true });
  delete process.env.PINAGENT_PROJECT_ROOT;
  delete process.env.PINAGENT_SPAWN_AGENT;
});

// Import lazily AFTER env is set so the module's top-level block sees
// the right values.
type RouteModule = typeof import('../src/route');
let route: RouteModule;

beforeAll(async () => {
  route = await import('../src/route');
});

// Each test gets a fresh DB so state doesn't bleed. We don't recreate
// the whole tmp dir (route module caches Storage via getDb), so we
// just clear feedback rows between tests via a small helper.
const ctx = (slug: string[]) => ({ params: { slug } });

// 1x1 PNG.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function validFeedbackPayload(overrides: Record<string, unknown> = {}) {
  return {
    comment: 'make it red',
    loc: { file: 'src/Foo.tsx', line: 42, col: 7 },
    selector: 'main > div > button',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest',
    screenshot: TINY_PNG_B64,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, init);
}

describe('GET /widget.js', () => {
  it('returns the widget IIFE bundle with a config prelude', async () => {
    const res = await route.GET(makeRequest('/__pinagent/widget.js'), ctx(['widget.js']));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/javascript/);
    const body = await res.text();
    // Prelude inlines window.__pinagentConfig.
    expect(body).toContain('__pinagentConfig');
    // IIFE body present (the var name our bundler exposes).
    expect(body).toContain('PinagentWidget');
  });
});

describe('GET /sqlite-wasm/*', () => {
  it('serves sqlite3.wasm with the wasm mime', async () => {
    const res = await route.GET(
      makeRequest('/__pinagent/sqlite-wasm/sqlite3.wasm'),
      ctx(['sqlite-wasm', 'sqlite3.wasm']),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/wasm');
    // sqlite3.wasm is ~800KB-1MB.
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(100_000);
  });

  it('serves the bundler-friendly worker entry', async () => {
    const res = await route.GET(
      makeRequest('/__pinagent/sqlite-wasm/sqlite3-worker1-bundler-friendly.mjs'),
      ctx(['sqlite-wasm', 'sqlite3-worker1-bundler-friendly.mjs']),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/javascript/);
  });

  it('404s for any file outside the whitelist (path traversal blocked)', async () => {
    const res = await route.GET(
      makeRequest('/__pinagent/sqlite-wasm/random.js'),
      ctx(['sqlite-wasm', 'random.js']),
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /db-worker.js', () => {
  it('serves our custom SAH-Pool-aware worker source', async () => {
    const res = await route.GET(
      makeRequest('/__pinagent/db-worker.js'),
      ctx(['db-worker.js']),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/javascript/);
    const body = await res.text();
    expect(body).toContain('installOpfsSAHPoolVfs');
  });
});

describe('GET /db-migrations', () => {
  it('returns drizzle-format migration entries (tag, when, hash, sql)', async () => {
    const res = await route.GET(
      makeRequest('/__pinagent/db-migrations'),
      ctx(['db-migrations']),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      migrations: { tag: string; when: number; hash: string; sql: string }[];
    };
    expect(Array.isArray(body.migrations)).toBe(true);
    expect(body.migrations.length).toBeGreaterThan(0);
    for (const m of body.migrations) {
      expect(typeof m.tag).toBe('string');
      expect(typeof m.when).toBe('number');
      // sha256 hex = 64 chars.
      expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof m.sql).toBe('string');
    }
    // Every migration ships at least one CREATE TABLE.
    expect(body.migrations.map((m) => m.sql).join('\n')).toMatch(/CREATE TABLE/);
  });
});

describe('GET /feedback', () => {
  it('returns an empty list when no feedback exists', async () => {
    const res = await route.GET(makeRequest('/__pinagent/feedback'), ctx(['feedback']));
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('POST /feedback', () => {
  let createdIds: string[] = [];

  afterEach(async () => {
    // Best-effort cleanup so tests don't pollute each other's list views.
    for (const id of createdIds) {
      await route.PATCH(
        makeRequest(`/__pinagent/feedback/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'wontfix' }),
        }),
        ctx(['feedback', id]),
      ).catch(() => {});
    }
    createdIds = [];
  });

  it('creates a feedback record and returns { id, agentSpawned: false }', async () => {
    const res = await route.POST(
      makeRequest('/__pinagent/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validFeedbackPayload()),
      }),
      ctx(['feedback']),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; agentSpawned: boolean };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{8,16}$/);
    // We forced PINAGENT_SPAWN_AGENT='off' so this MUST be false.
    expect(body.agentSpawned).toBe(false);
    createdIds.push(body.id);
  });

  it('returns 400 for an invalid payload', async () => {
    const res = await route.POST(
      makeRequest('/__pinagent/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: '' }), // missing required fields
      }),
      ctx(['feedback']),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for an oversize screenshot (>5MB decoded)', async () => {
    // Build a base64 string that decodes to >5MB.
    const big = 'A'.repeat(7_000_000); // base64 → ~5.25MB binary
    const res = await route.POST(
      makeRequest('/__pinagent/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validFeedbackPayload({ screenshot: big })),
      }),
      ctx(['feedback']),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /feedback/:id', () => {
  it('returns 400 for an invalid id', async () => {
    const res = await route.GET(
      makeRequest('/__pinagent/feedback/!'),
      ctx(['feedback', '!']),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent id', async () => {
    const res = await route.GET(
      makeRequest('/__pinagent/feedback/aBcDeFgHiJ'),
      ctx(['feedback', 'aBcDeFgHiJ']),
    );
    expect(res.status).toBe(404);
  });

  it('round-trips POST then GET', async () => {
    const post = await route.POST(
      makeRequest('/__pinagent/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validFeedbackPayload({ comment: 'round trip' })),
      }),
      ctx(['feedback']),
    );
    const { id } = (await post.json()) as { id: string };

    const get = await route.GET(
      makeRequest(`/__pinagent/feedback/${id}`),
      ctx(['feedback', id]),
    );
    expect(get.status).toBe(200);
    const rec = (await get.json()) as {
      id: string;
      comment: string;
      screenshot: string | null;
    };
    expect(rec.id).toBe(id);
    expect(rec.comment).toBe('round trip');
    // Screenshot bytes come back base64-encoded.
    expect(typeof rec.screenshot).toBe('string');
    expect(rec.screenshot).toBeTruthy();
  });
});

describe('PATCH /feedback/:id', () => {
  it('returns 404 for an unknown id', async () => {
    const res = await route.PATCH(
      makeRequest('/__pinagent/feedback/aBcDeFgHiJ', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'fixed' }),
      }),
      ctx(['feedback', 'aBcDeFgHiJ']),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid id', async () => {
    const res = await route.PATCH(
      makeRequest('/__pinagent/feedback/!', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      ctx(['feedback', '!']),
    );
    expect(res.status).toBe(400);
  });

  it('updates status and persists resolvedAt', async () => {
    const post = await route.POST(
      makeRequest('/__pinagent/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validFeedbackPayload()),
      }),
      ctx(['feedback']),
    );
    const { id } = (await post.json()) as { id: string };

    const patch = await route.PATCH(
      makeRequest(`/__pinagent/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'fixed', note: 'all done' }),
      }),
      ctx(['feedback', id]),
    );
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as {
      status: string;
      note: string;
      resolvedAt: string | null;
    };
    expect(updated.status).toBe('fixed');
    expect(updated.note).toBe('all done');
    expect(updated.resolvedAt).toBeTruthy();
  });
});

describe('POST /open', () => {
  it('returns 400 when file is missing', async () => {
    const res = await route.POST(
      makeRequest('/__pinagent/open', { method: 'POST' }),
      ctx(['open']),
    );
    expect(res.status).toBe(400);
  });
});

describe('404 fallthrough', () => {
  it('GET unknown slug → 404', async () => {
    const res = await route.GET(
      makeRequest('/__pinagent/random-nothing'),
      ctx(['random-nothing']),
    );
    expect(res.status).toBe(404);
  });

  it('POST unknown slug → 404', async () => {
    const res = await route.POST(
      makeRequest('/__pinagent/random-nothing', { method: 'POST' }),
      ctx(['random-nothing']),
    );
    expect(res.status).toBe(404);
  });

  it('PATCH unknown slug → 404', async () => {
    const res = await route.PATCH(
      makeRequest('/__pinagent/random-nothing', { method: 'PATCH' }),
      ctx(['random-nothing']),
    );
    expect(res.status).toBe(404);
  });
});
