// SPDX-License-Identifier: Apache-2.0

import { mkdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@pinagent/agent-runner';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
