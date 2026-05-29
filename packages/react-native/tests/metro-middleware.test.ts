// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@pinagent/agent-runner';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pinagentMiddleware } from '../src/server/metro-middleware';

// 1x1 transparent PNG — same placeholder the widget falls back to.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function validFeedback(overrides: Record<string, unknown> = {}) {
  return {
    comment: 'rename this button to Banana',
    loc: { file: 'src/HomeScreen.tsx', line: 42, col: 7 },
    selector: 'App > HomeScreen > PrimaryButton',
    url: 'ios',
    viewport: { w: 390, h: 844 },
    userAgent: 'ios 17.0',
    screenshot: PNG_B64,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Minimal IncomingMessage stand-in that streams `body` then ends. */
function mockReq(method: string, url: string, body?: string) {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    destroy: () => void;
  };
  req.method = method;
  req.url = url;
  req.destroy = () => {};
  // Emit on the next tick so the middleware's stream listeners are attached.
  setImmediate(() => {
    if (body != null) req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  return req;
}

/** Minimal ServerResponse stand-in that resolves `done` when `end()` fires. */
function mockRes() {
  let resolveEnd!: () => void;
  const done = new Promise<void>((r) => {
    resolveEnd = r;
  });
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    end(chunk?: string) {
      if (chunk) this.body += chunk;
      resolveEnd();
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: structural stand-in for ServerResponse
  return { res: res as any, done, parse: () => JSON.parse(res.body) };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pinagent-rn-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('pinagentMiddleware', () => {
  it('non-pinagent URLs fall through to next', async () => {
    const mw = pinagentMiddleware({ projectRoot: root, spawnMode: false });
    let nexted = false;
    mw(mockReq('GET', '/index.bundle'), mockRes().res, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
  });

  it('POST /__pinagent/feedback persists a conversation to .pinagent/db.sqlite', async () => {
    const mw = pinagentMiddleware({ projectRoot: root, spawnMode: false });
    const body = JSON.stringify(validFeedback());
    const { res, done, parse } = mockRes();

    mw(mockReq('POST', '/__pinagent/feedback', body), res, () => {
      throw new Error('should not fall through');
    });
    await done;

    expect(res.statusCode).toBe(200);
    const out = parse() as { id: string; agentSpawned: boolean };
    expect(out.id).toMatch(/^[\w-]{10}$/);
    expect(out.agentSpawned).toBe(false); // spawnMode: false

    // The real backend wrote it — read it back the way the MCP server would.
    const rec = await new Storage(root).read(out.id);
    expect(rec?.comment).toBe('rename this button to Banana');
    expect(rec?.file).toBe('src/HomeScreen.tsx');
    expect(rec?.line).toBe(42);
    expect(rec?.status).toBe('pending');
  });

  it('rejects an invalid body with 400', async () => {
    const mw = pinagentMiddleware({ projectRoot: root, spawnMode: false });
    const body = JSON.stringify(validFeedback({ comment: '' })); // min(1) violated
    const { res, done } = mockRes();
    mw(mockReq('POST', '/__pinagent/feedback', body), res, () => {});
    await done;
    expect(res.statusCode).toBe(400);
  });

  it('GET /__pinagent/feedback lists created conversations', async () => {
    const mw = pinagentMiddleware({ projectRoot: root, spawnMode: false });

    const post = mockRes();
    mw(
      mockReq('POST', '/__pinagent/feedback', JSON.stringify(validFeedback())),
      post.res,
      () => {},
    );
    await post.done;

    const list = mockRes();
    mw(mockReq('GET', '/__pinagent/feedback'), list.res, () => {});
    await list.done;

    expect(list.res.statusCode).toBe(200);
    const items = list.parse() as Array<{ comment: string }>;
    expect(items).toHaveLength(1);
    expect(items[0]?.comment).toBe('rename this button to Banana');
  });
});
