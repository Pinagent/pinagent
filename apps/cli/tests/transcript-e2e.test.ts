// SPDX-License-Identifier: Apache-2.0
/**
 * End-to-end integration test for the transcript stack.
 *
 * Wires the real pieces together for one assertion:
 *
 *   bus.publish (agent-runner)
 *     → SQLite messages table
 *     → vite-plugin middleware GET /__pinagent/feedback/:id/messages
 *     → fetchTranscript (CLI / shared zod parse)
 *     → renderTranscript (shared)
 *
 * Catches the gap between "every layer has a passing unit test" and
 * "the layers actually compose" — wire-format drift, header
 * disagreement, schema-evolution mismatches all surface here. Unit
 * tests can't see any of those.
 */

import { mkdir, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateBus, Storage } from '@pinagent/agent-runner';
import { renderTranscript } from '@pinagent/shared';
import { createMiddleware } from '@pinagent/vite-plugin';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchTranscript } from '../src/transcript';

const PROJECT_ROOT = join(tmpdir(), `pa-cli-e2e-${nanoid(8)}`);
let server: Server;
let serverUrl: string;

beforeAll(async () => {
  await mkdir(PROJECT_ROOT, { recursive: true });

  // `new Storage(root)` doesn't create the .pinagent dir on construct —
  // its first DB access does, after `getDb` lazily applies migrations.
  // Touching `.list()` here forces both side-effects so the messages
  // table exists by the time we publish to the bus below.
  const storage = new Storage(PROJECT_ROOT);
  await storage.list();

  // Seed: insert a conversation row so the messages FK is satisfied,
  // then publish events through the real bus. POST /__pinagent/feedback
  // is the normal create path but it also tries to spawn an agent —
  // bypass by writing a fixture conversation directly through Storage's
  // create path with a feedback id we control.
  const feedbackId = 'cv_e2e_001';
  await storage.create(feedbackId, {
    comment: 'e2e seed',
    loc: { file: 'src/Foo.tsx', line: 1, col: 1 },
    selector: 'button',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest-e2e',
    screenshot:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    createdAt: new Date().toISOString(),
  });

  const bus = getOrCreateBus(feedbackId, PROJECT_ROOT);
  await bus.publish({
    type: 'init',
    sessionId: 'sess-e2e',
    model: 'claude-test',
    permissionMode: 'acceptEdits',
    apiKeySource: 'oauth',
  });
  await bus.publish({ type: 'text', text: 'first agent reply' });
  await bus.publish({ type: 'tool_use', name: 'Edit', summary: 'src/Foo.tsx' });
  await bus.publish({ type: 'tool_result', ok: true });

  // Boot the real vite-plugin middleware on a real HTTP server. Same
  // shape Vite uses in dev: a Connect-style handler wrapped in
  // `http.createServer`. `spawnMode: false` skips the agent spawn the
  // POST handler would otherwise try to do; `wsPort: null` skips
  // WebSocket plumbing the test doesn't need.
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
  serverUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(PROJECT_ROOT, { recursive: true, force: true });
});

describe('CLI fetchTranscript ↔ vite-plugin /messages endpoint', () => {
  it('round-trips four published events through the full stack', async () => {
    const events = await fetchTranscript({ serverUrl, id: 'cv_e2e_001' });
    expect(events.map((e) => e.type)).toEqual(['init', 'text', 'tool_use', 'tool_result']);
    expect(events[0]).toMatchObject({
      type: 'init',
      sessionId: 'sess-e2e',
      model: 'claude-test',
      permissionMode: 'acceptEdits',
    });
  });

  it('renders the fetched events into the documented plain-text format', async () => {
    // Pinned end-to-end: byte-identical output is what `pinagent
    // transcript` writes and what the MCP tool returns when called
    // with format: 'text'. If the wire payload changes shape, this
    // string flips — the integration test catches what unit tests
    // can't.
    const events = await fetchTranscript({ serverUrl, id: 'cv_e2e_001' });
    const out = renderTranscript(events);
    expect(out).toBe(
      [
        '[init] sess-e2e · claude-test · acceptEdits (oauth)',
        '',
        '> first agent reply',
        '',
        '[tool_use] Edit · src/Foo.tsx',
        '',
        '[tool_result] ok',
        '',
      ].join('\n'),
    );
  });

  it('returns 404 for an unknown conversation id (typed error from fetchTranscript)', async () => {
    await expect(fetchTranscript({ serverUrl, id: 'aBcDeFgHiJ' })).rejects.toMatchObject({
      name: 'TranscriptHttpError',
      status: 404,
    });
  });

  it('returns 400 for a malformed id', async () => {
    // The middleware rejects ids that don't match ID_RE before hitting
    // storage; this pins that the CLI surfaces the right exit code.
    await expect(fetchTranscript({ serverUrl, id: '!' })).rejects.toMatchObject({
      name: 'TranscriptHttpError',
      status: 400,
    });
  });
});
