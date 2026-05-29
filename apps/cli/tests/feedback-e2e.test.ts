// SPDX-License-Identifier: Apache-2.0
/**
 * End-to-end integration test for `pinagent list` and `pinagent
 * resolve` against the real vite-plugin middleware:
 *
 *   Storage.create (agent-runner)
 *     → SQLite conversations table
 *     → vite-plugin middleware GET  /__pinagent/feedback
 *                              PATCH /__pinagent/feedback/:id
 *     → fetchFeedbackList / patchFeedbackStatus (CLI zod parse)
 *
 * Catches wire-format drift between the shallow list projection / patch
 * response and what the CLI expects — the thing unit tests can't see.
 */
import { mkdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@pinagent/agent-runner';
import { createMiddleware } from '@pinagent/vite-plugin';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchFeedbackList, patchFeedbackStatus } from '../src/feedback';
import { baseUrl, requestJson } from '../src/http';

const PROJECT_ROOT = join(tmpdir(), `pa-cli-fb-e2e-${nanoid(8)}`);
const FEEDBACK_ID = 'cvfbe2e01';
let server: Server;
let serverUrl: string;

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

beforeAll(async () => {
  await mkdir(PROJECT_ROOT, { recursive: true });

  const storage = new Storage(PROJECT_ROOT);
  await storage.list(); // force migrations + .pinagent dir

  await storage.create(FEEDBACK_ID, {
    comment: 'Tweak the hero spacing',
    loc: { file: 'src/Hero.tsx', line: 12, col: 3 },
    selector: 'section',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest-e2e',
    screenshot: PNG_1PX,
    createdAt: new Date().toISOString(),
  });

  const handler = createMiddleware({ storage, spawnMode: false, wsPort: null, dock: false });
  server = createServer((req, res) => {
    handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(PROJECT_ROOT, { recursive: true, force: true });
});

describe('CLI feedback commands ↔ vite-plugin endpoints', () => {
  it('list surfaces the seeded conversation with its file:line', async () => {
    const rows = await fetchFeedbackList(serverUrl);
    const row = rows.find((r) => r.id === FEEDBACK_ID);
    expect(row).toMatchObject({
      id: FEEDBACK_ID,
      status: 'pending',
      file: 'src/Hero.tsx',
      line: 12,
    });
  });

  it('resolve PATCHes the status and round-trips the updated record', async () => {
    const updated = await patchFeedbackStatus({
      id: FEEDBACK_ID,
      status: 'fixed',
      note: 'Adjusted padding',
      commitSha: null,
      serverUrl,
      json: false,
    });
    expect(updated).toMatchObject({ id: FEEDBACK_ID, status: 'fixed' });

    // The change is visible on the next list call.
    const rows = await fetchFeedbackList(serverUrl);
    expect(rows.find((r) => r.id === FEEDBACK_ID)?.status).toBe('fixed');
  });

  it('resolve throws a typed 404 for an unknown id', async () => {
    await expect(
      patchFeedbackStatus({
        id: 'aBcDeFgHiJ',
        status: 'fixed',
        note: null,
        commitSha: null,
        serverUrl,
        json: false,
      }),
    ).rejects.toMatchObject({ name: 'HttpError', status: 404 });
  });

  it('resolve surfaces a 400 for a malformed status the server rejects', async () => {
    // ID_RE passes on the CLI side, but the server's PatchSchema rejects
    // an unknown status — pins that requestJson maps the 400 through as a
    // typed HttpError (the CLI then exits 2).
    await expect(
      requestJson(`${baseUrl(serverUrl)}/__pinagent/feedback/${FEEDBACK_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'not-a-status' }),
      }),
    ).rejects.toMatchObject({ name: 'HttpError', status: 400 });
  });
});
