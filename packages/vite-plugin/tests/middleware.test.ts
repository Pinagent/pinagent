// SPDX-License-Identifier: Apache-2.0

import { mkdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@pinagent/agent-runner';
import { nanoid } from 'nanoid';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMiddleware } from '../src/middleware';

/**
 * Middleware integration test. Mounts the Connect-style middleware on
 * a real `http.createServer` so we can hit it with `fetch` — same
 * shape Vite uses in dev. Mirrors `next-plugin/tests/route.test.ts`'s
 * projection check; the two plugins keep identical shallow
 * projections (per the inline sync comment in both files), and we
 * want a regression test on each side.
 */

const PROJECT_ROOT = join(tmpdir(), `pa-mw-${nanoid(8)}`);
let server: Server;
let base: string;

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

beforeAll(async () => {
  await mkdir(PROJECT_ROOT, { recursive: true });
  const storage = new Storage(PROJECT_ROOT);
  const handler = createMiddleware({
    storage,
    spawnMode: false,
    wsPort: null,
    dock: false,
  });
  server = createServer((req, res) => {
    handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(PROJECT_ROOT, { recursive: true, force: true });
});

function validFeedbackPayload(overrides: Record<string, unknown> = {}) {
  return {
    comment: 'make it red',
    loc: { file: 'src/Foo.tsx', line: 42, col: 7 },
    selector: 'main > div > button',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest',
    screenshot: TINY_PNG,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('GET /__pinagent/feedback', () => {
  it('projects every field the dock parses with `FeedbackRecordSchema`', async () => {
    // Mirror of `FeedbackRecordSchema` in
    // `@pinagent/widget-dock/src/transport/local.ts`. Pinned inline so
    // a server-side projection that drops a field fails this test, NOT
    // just a silent zod-default in the dock. Regressions we've taken:
    // missing `worktreeState`/`branch`/`updatedAt` ("Couldn't load
    // conversations"); missing `title` + `archived` (rename and
    // archive silently no-op on the list). Fields with `.default()` on
    // the dock side are the dangerous ones — their absence is
    // invisible.
    const FeedbackRecordWireSchema = z
      .object({
        id: z.string(),
        comment: z.string(),
        file: z.string().nullable(),
        line: z.number().nullable(),
        col: z.number().nullable(),
        selector: z.string(),
        url: z.string(),
        status: z.enum(['pending', 'fixed', 'wontfix', 'deferred']),
        worktreeState: z.enum(['none', 'active', 'landed', 'discarded']),
        title: z.string().nullable(),
        archived: z.boolean(),
        branch: z.string().nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
      .loose();

    // Seed one row so the projection actually has a payload to
    // validate — an empty array can't catch a missing field.
    const created = await fetch(`${base}/__pinagent/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validFeedbackPayload()),
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };

    const res = await fetch(`${base}/__pinagent/feedback`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    const parsed = z.array(FeedbackRecordWireSchema).safeParse(body);
    if (!parsed.success) {
      throw new Error(
        `feedback projection drifted from FeedbackRecordSchema:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    expect(parsed.data.length).toBeGreaterThan(0);

    // Cleanup so the seeded row doesn't pollute later assertions.
    await fetch(`${base}/__pinagent/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'wontfix' }),
    });
  });
});

describe('GET /__pinagent/settings — permissionModeOverride', () => {
  // `PINAGENT_AGENT_PERMISSION_MODE` is process-global. Capture-and-
  // restore so the assertion ordering in this file (and others) stays
  // independent of whoever ran last.
  let priorEnv: string | undefined;
  beforeEach(() => {
    priorEnv = process.env.PINAGENT_AGENT_PERMISSION_MODE;
    delete process.env.PINAGENT_AGENT_PERMISSION_MODE;
  });
  afterEach(() => {
    if (priorEnv === undefined) delete process.env.PINAGENT_AGENT_PERMISSION_MODE;
    else process.env.PINAGENT_AGENT_PERMISSION_MODE = priorEnv;
  });

  it('returns permissionModeOverride: null when no env is set', async () => {
    const res = await fetch(`${base}/__pinagent/settings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { permissionModeOverride: string | null };
    expect(body.permissionModeOverride).toBeNull();
  });

  it('returns the resolved SDK mode when PINAGENT_AGENT_PERMISSION_MODE is set', async () => {
    process.env.PINAGENT_AGENT_PERMISSION_MODE = 'plan';
    const res = await fetch(`${base}/__pinagent/settings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { permissionModeOverride: string | null };
    expect(body.permissionModeOverride).toBe('plan');
  });

  it('coerces invalid env values to the resolver default (acceptEdits), not null', async () => {
    // The override is "active" any time the env is set — even garbage
    // values flow through `resolvePermissionMode`'s fallback to
    // `acceptEdits`. Banner should still show; users will see the
    // value they typed is being treated as the fallback.
    process.env.PINAGENT_AGENT_PERMISSION_MODE = 'not-a-mode';
    const res = await fetch(`${base}/__pinagent/settings`);
    const body = (await res.json()) as { permissionModeOverride: string | null };
    expect(body.permissionModeOverride).toBe('acceptEdits');
  });
});

describe('GET /__pinagent/widget.js', () => {
  it('returns the widget IIFE bundle with a config prelude', async () => {
    const res = await fetch(`${base}/__pinagent/widget.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/javascript/);
    const body = await res.text();
    // Prelude inlines window.__pinagentConfig.
    expect(body).toContain('__pinagentConfig');
    // IIFE body present: wrapped in a function-expression and non-trivial in size.
    // Mirrors the next-plugin assertion — widget src has zero exports, so we
    // don't pin a bundler-injected global name.
    expect(body).toMatch(/[;(]\s*\(function\s*\(\s*\)\s*\{/);
    expect(body.length).toBeGreaterThan(50_000);
  });

  it('inlines wsUrl: null when wsPort is null', async () => {
    // The shared server in this file was created with wsPort: null, so
    // the prelude should hand the widget `{wsUrl:null}`. Pinned because
    // the widget falls back to its own port discovery when wsUrl is
    // missing — a regression here would silently re-enable that path.
    const res = await fetch(`${base}/__pinagent/widget.js`);
    const body = await res.text();
    expect(body).toContain('"wsUrl":null');
  });
});

describe('GET /__pinagent/db-worker.js', () => {
  it('serves the SAH-Pool-aware worker source', async () => {
    const res = await fetch(`${base}/__pinagent/db-worker.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/javascript/);
    const body = await res.text();
    expect(body).toContain('installOpfsSAHPoolVfs');
  });
});

describe('GET /__pinagent/db-migrations', () => {
  it('returns drizzle-format migration entries (tag, when, hash, sql)', async () => {
    const res = await fetch(`${base}/__pinagent/db-migrations`);
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

describe('GET /__pinagent/sqlite-wasm/*', () => {
  it('serves sqlite3.wasm with the wasm mime', async () => {
    const res = await fetch(`${base}/__pinagent/sqlite-wasm/sqlite3.wasm`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/wasm');
    const buf = await res.arrayBuffer();
    // sqlite3.wasm is ~800KB-1MB.
    expect(buf.byteLength).toBeGreaterThan(100_000);
  });

  it('serves the bundler-friendly worker entry', async () => {
    const res = await fetch(`${base}/__pinagent/sqlite-wasm/sqlite3-worker1-bundler-friendly.mjs`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/javascript/);
  });

  it('404s for any file outside the whitelist (path traversal blocked)', async () => {
    const res = await fetch(`${base}/__pinagent/sqlite-wasm/random.js`);
    expect(res.status).toBe(404);
  });
});

describe('POST /__pinagent/feedback', () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    // Best-effort cleanup so tests don't pollute each other's list views.
    for (const id of createdIds.splice(0)) {
      await fetch(`${base}/__pinagent/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'wontfix' }),
      }).catch(() => {});
    }
  });

  it('creates a feedback record and returns { id, agentSpawned: false }', async () => {
    const res = await fetch(`${base}/__pinagent/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validFeedbackPayload()),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; agentSpawned: boolean };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{8,16}$/);
    // The shared server was created with spawnMode: false, so this MUST be false.
    expect(body.agentSpawned).toBe(false);
    createdIds.push(body.id);
  });

  it('returns 400 for an invalid payload', async () => {
    const res = await fetch(`${base}/__pinagent/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment: '' }), // missing required fields
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an oversize screenshot (>5MB decoded)', async () => {
    // base64 of all 'A' decodes to all-zero bytes; size check fires
    // before any PNG validation.
    const big = 'A'.repeat(7_000_000); // base64 → ~5.25MB binary
    const res = await fetch(`${base}/__pinagent/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validFeedbackPayload({ screenshot: big })),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /__pinagent/feedback/:id', () => {
  it('returns 400 for an invalid id', async () => {
    const res = await fetch(`${base}/__pinagent/feedback/!`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent id', async () => {
    const res = await fetch(`${base}/__pinagent/feedback/aBcDeFgHiJ`);
    expect(res.status).toBe(404);
  });

  it('round-trips POST then GET', async () => {
    const post = await fetch(`${base}/__pinagent/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validFeedbackPayload({ comment: 'round trip' })),
    });
    const { id } = (await post.json()) as { id: string };

    const get = await fetch(`${base}/__pinagent/feedback/${id}`);
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

    await fetch(`${base}/__pinagent/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'wontfix' }),
    });
  });
});

describe('PATCH /__pinagent/feedback/:id', () => {
  it('returns 404 for an unknown id', async () => {
    const res = await fetch(`${base}/__pinagent/feedback/aBcDeFgHiJ`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'fixed' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid id', async () => {
    const res = await fetch(`${base}/__pinagent/feedback/!`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('updates status and persists resolvedAt', async () => {
    const post = await fetch(`${base}/__pinagent/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validFeedbackPayload()),
    });
    const { id } = (await post.json()) as { id: string };

    const patch = await fetch(`${base}/__pinagent/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'fixed', note: 'all done' }),
    });
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

describe('POST /__pinagent/open', () => {
  it('returns 400 when file is missing', async () => {
    const res = await fetch(`${base}/__pinagent/open`, { method: 'POST' });
    expect(res.status).toBe(400);
  });
});

describe('404 fallthrough', () => {
  it('GET unknown slug → 404', async () => {
    const res = await fetch(`${base}/__pinagent/random-nothing`);
    expect(res.status).toBe(404);
  });

  it('POST unknown slug → 404', async () => {
    const res = await fetch(`${base}/__pinagent/random-nothing`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('PATCH unknown slug → 404', async () => {
    const res = await fetch(`${base}/__pinagent/random-nothing`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /__pinagent/feedback/:id/messages', () => {
  it('returns 400 for an invalid id', async () => {
    const res = await fetch(`${base}/__pinagent/feedback/!/messages`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown but well-formed id', async () => {
    const res = await fetch(`${base}/__pinagent/feedback/aBcDeFgHiJ/messages`);
    expect(res.status).toBe(404);
  });

  it('returns { messages: [] } for a fresh conversation with no published events', async () => {
    const post = await fetch(`${base}/__pinagent/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validFeedbackPayload({ comment: 'no-events' })),
    });
    const { id } = (await post.json()) as { id: string };

    const res = await fetch(`${base}/__pinagent/feedback/${id}/messages`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages).toEqual([]);

    // Cleanup so seeded row doesn't pollute later assertions.
    await fetch(`${base}/__pinagent/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'wontfix' }),
    });
  });
});
