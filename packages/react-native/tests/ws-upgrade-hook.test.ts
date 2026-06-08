// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { getOrCreateBus, Storage } from '@pinagent/agent-runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pinagentMiddleware } from '../src/server/metro-middleware';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Regression test for the Expo dev server, which — unlike bare Metro's
// `runServer` — ignores `config.server.websocketEndpoints` and registers a
// single `upgrade` listener that `socket.destroy()`s any path it doesn't
// recognise. That silently dropped `/__pinagent/ws`, so the RN stream sheet
// stuck on "Connecting…" while the agent ran fine over the (honored) feedback
// middleware.
//
// Here we stand up a server that behaves like Expo: an Expo-style `upgrade`
// listener is attached FIRST (mirroring Expo registering its own in the
// `listen()` callback), then a normal HTTP request flows through
// `pinagentMiddleware`, which self-installs the `/__pinagent/ws` handler on the
// live server. We then assert streaming works AND that the pre-existing
// listener still gets delegated every non-pinagent upgrade path.

let server: Server;
let port = 0;
let projectRoot: string;
const droppedUpgradePaths: string[] = [];

beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pinagent-rnexpo-'));
  process.env.PINAGENT_PROJECT_ROOT = projectRoot;

  const mw = pinagentMiddleware({ projectRoot, spawnMode: false });
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    mw(req, res, () => {
      res.statusCode = 404;
      res.end('next');
    });
  });

  // Expo-style upgrade handler: record + destroy anything it doesn't know.
  // Our middleware must take this over and delegate non-pinagent paths back to
  // it rather than racing it.
  server.on('upgrade', (req, socket: Duplex) => {
    droppedUpgradePaths.push((req.url ?? '').split('?')[0] ?? '');
    socket.destroy();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(() => {
  server?.close();
});

function connect(path: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error('ws connect failed')));
  });
}

describe('rn ws upgrade hook (Expo compatibility)', () => {
  it('streams over /__pinagent/ws even when the host drops unknown upgrades', async () => {
    const feedbackId = 'rnexpo0001';
    await new Storage(projectRoot).create(feedbackId, {
      comment: 'expo stream test',
      loc: null,
      selector: '',
      url: 'ios',
      viewport: { w: 1, h: 1 },
      userAgent: 'test',
      screenshot: PNG,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    // A plain HTTP request makes the middleware self-install the upgrade
    // handler — exactly what the bundle fetch does before the widget connects.
    await fetch(`http://127.0.0.1:${port}/__pinagent/feedback`);

    const socket = await connect('/__pinagent/ws');

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
    await new Promise((r) => setTimeout(r, 120));

    const bus = getOrCreateBus(feedbackId, projectRoot);
    await bus.publish({ type: 'text', text: 'On it.' });
    await bus.publish({ type: 'tool_use', name: 'Edit', summary: 'App.tsx' });
    await bus.publish({ type: 'tool_result', ok: true });
    await bus.markFinished();

    await finished;
    socket.close();

    expect(eventTypes).toEqual(['text', 'tool_use', 'tool_result']);
    // Our path was handled by us, never delegated to the Expo-style destroyer.
    expect(droppedUpgradePaths).not.toContain('/__pinagent/ws');
  });

  it('delegates non-pinagent upgrade paths back to the host listener', async () => {
    await expect(connect('/hot')).rejects.toThrow();
    // The pre-existing (Expo-style) listener still saw and destroyed `/hot`.
    expect(droppedUpgradePaths).toContain('/hot');
  });
});
