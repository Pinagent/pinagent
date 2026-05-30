// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { getOrCreateBus, Storage } from '@pinagent/agent-runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pinagentWebsocketEndpoints } from '../src/server/ws-endpoint';

// Client uses Node's built-in global WebSocket (stable since 22) so the RN
// package doesn't need its own `ws` dependency — the server side gets the
// WebSocketServer from @pinagent/agent-runner, where `ws` already lives.

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// End-to-end test of the RN WebSocket endpoint. We stand up a plain Node HTTP
// server and route its `upgrade` event by pathname into the endpoint map —
// exactly what Metro does with `config.server.websocketEndpoints`. Then we
// connect a real `ws` client, subscribe to a feedback id, publish agent events
// through the same in-process bus, and assert they arrive followed by `done`.
//
// This proves the wire path the in-app widget relies on: subscribe → event* →
// done, over Metro's own port (no separate WS server, no port discovery).

let server: Server;
let wsUrl: string;
let projectRoot: string;

beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pinagent-rnws-'));
  process.env.PINAGENT_PROJECT_ROOT = projectRoot;

  const endpoints = pinagentWebsocketEndpoints({ projectRoot });
  server = createServer((_req, res) => res.end('ok'));
  server.on('upgrade', (req, socket: Duplex, head) => {
    const path = (req.url ?? '').split('?')[0];
    const wss = endpoints[path];
    if (!wss) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  wsUrl = `ws://127.0.0.1:${port}/__pinagent/ws`;
});

afterAll(() => {
  server?.close();
});

function connect(): Promise<WebSocket> {
  const socket = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error('ws connect failed')));
  });
}

describe('rn ws-endpoint', () => {
  it('streams an agent run to a subscribed feedback id, then done', async () => {
    const feedbackId = 'rnwstest01';
    // Events INSERT into `messages`, which has an FK to `conversations` — so the
    // conversation row must exist first (the middleware does this on the POST
    // before spawning an agent; here we create it directly).
    await new Storage(projectRoot).create(feedbackId, {
      comment: 'stream test',
      loc: null,
      selector: '',
      url: 'ios',
      viewport: { w: 1, h: 1 },
      userAgent: 'test',
      screenshot: PNG,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const socket = await connect();

    const eventTypes: string[] = [];
    const finished = new Promise<void>((resolve) => {
      socket.addEventListener('message', (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === 'event' && msg.feedbackId === feedbackId) {
          eventTypes.push(msg.event.type);
        }
        if (msg.type === 'done' && msg.feedbackId === feedbackId) resolve();
      });
    });

    socket.send(JSON.stringify({ type: 'subscribe', feedbackId }));
    // Let the subscription's bus poller spin up before publishing.
    await new Promise((r) => setTimeout(r, 120));

    const bus = getOrCreateBus(feedbackId, projectRoot);
    await bus.publish({
      type: 'init',
      sessionId: 'sess',
      model: 'claude',
      permissionMode: 'default',
      apiKeySource: 'oauth',
    });
    await bus.publish({ type: 'text', text: 'On it.' });
    await bus.publish({ type: 'tool_use', name: 'Edit', summary: 'App.tsx' });
    await bus.publish({ type: 'tool_result', ok: true });
    await bus.publish({
      type: 'result',
      subtype: 'success',
      numTurns: 1,
      totalCostUsd: 0.01,
      durationMs: 100,
    });
    await bus.markFinished();

    await finished;
    socket.close();

    // Order-preserving subset (worktree_state frames are interleaved and ignored).
    expect(eventTypes).toEqual(['init', 'text', 'tool_use', 'tool_result', 'result']);
  });
});
