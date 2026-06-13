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
    // Single pick → additional_anchors stays null (web parity, ticket 008).
    expect(rec?.additionalAnchors).toBeNull();
  });

  it('persists multi-picked additionalAnchors through the real Storage (ticket 008)', async () => {
    const mw = pinagentMiddleware({ projectRoot: root, spawnMode: false });
    const body = JSON.stringify(
      validFeedback({
        additionalAnchors: [
          {
            file: 'src/Card.tsx',
            line: 12,
            col: 3,
            selector: 'App > Home > Card > Button',
            clickX: 50,
            clickY: 120,
          },
          {
            file: 'src/Card.tsx',
            line: 30,
            col: 5,
            selector: 'App > Home > Card > Link',
            clickX: 80,
            clickY: 200,
          },
        ],
      }),
    );
    const { res, done, parse } = mockRes();
    mw(mockReq('POST', '/__pinagent/feedback', body), res, () => {});
    await done;

    expect(res.statusCode).toBe(200);
    const out = parse() as { id: string };
    const rec = await new Storage(root).read(out.id);
    expect(rec?.additionalAnchors).toHaveLength(2);
    expect(rec?.additionalAnchors?.map((a) => a.line)).toEqual([12, 30]);
    expect(rec?.additionalAnchors?.[0]).toMatchObject({
      file: 'src/Card.tsx',
      selector: 'App > Home > Card > Button',
      clickX: 50,
      clickY: 120,
    });
  });

  it('rejects an invalid body with 400', async () => {
    const mw = pinagentMiddleware({ projectRoot: root, spawnMode: false });
    const body = JSON.stringify(validFeedback({ comment: '' })); // min(1) violated
    const { res, done } = mockRes();
    mw(mockReq('POST', '/__pinagent/feedback', body), res, () => {});
    await done;
    expect(res.statusCode).toBe(400);
  });

  describe('POST /__pinagent/open', () => {
    it('rejects a missing file with 400', async () => {
      const mw = pinagentMiddleware({ projectRoot: root, spawnMode: false });
      const { res, done } = mockRes();
      mw(mockReq('POST', '/__pinagent/open', JSON.stringify({ line: 1 })), res, () => {});
      await done;
      expect(res.statusCode).toBe(400);
    });

    it('rejects a path that escapes the project root with 400', async () => {
      const mw = pinagentMiddleware({ projectRoot: root, spawnMode: false });
      const { res, done } = mockRes();
      const body = JSON.stringify({ file: '../../../../etc/passwd', line: 1, col: 1 });
      mw(mockReq('POST', '/__pinagent/open', body), res, () => {});
      await done;
      expect(res.statusCode).toBe(400);
    });

    it('accepts an in-root path and reports the editor launch', async () => {
      // `true` is a harmless stand-in for an editor binary — spawns, ignores
      // its args, exits 0 — so the test never opens a real editor.
      const prev = process.env.PINAGENT_EDITOR;
      process.env.PINAGENT_EDITOR = 'true';
      try {
        const mw = pinagentMiddleware({ projectRoot: root, spawnMode: false });
        const { res, done, parse } = mockRes();
        const body = JSON.stringify({ file: 'src/HomeScreen.tsx', line: 42, col: 7 });
        mw(mockReq('POST', '/__pinagent/open', body), res, () => {});
        await done;
        expect(res.statusCode).toBe(200);
        expect((parse() as { ok: boolean }).ok).toBe(true);
      } finally {
        if (prev === undefined) delete process.env.PINAGENT_EDITOR;
        else process.env.PINAGENT_EDITOR = prev;
      }
    });
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

  // ticket 011 — the `apiKey` option bridges to PINAGENT_AGENT_API_KEY exactly
  // like vite-plugin's option. The middleware is Node code, so the bridge IS
  // unit-testable (unlike the native side).
  describe('apiKey → PINAGENT_AGENT_API_KEY bridge', () => {
    let prevAgentKey: string | undefined;

    beforeEach(() => {
      prevAgentKey = process.env.PINAGENT_AGENT_API_KEY;
      delete process.env.PINAGENT_AGENT_API_KEY;
    });
    afterEach(() => {
      if (prevAgentKey === undefined) delete process.env.PINAGENT_AGENT_API_KEY;
      else process.env.PINAGENT_AGENT_API_KEY = prevAgentKey;
    });

    it('sets PINAGENT_AGENT_API_KEY when apiKey is provided', () => {
      pinagentMiddleware({ projectRoot: root, spawnMode: false, apiKey: 'sk-test-123' });
      expect(process.env.PINAGENT_AGENT_API_KEY).toBe('sk-test-123');
    });

    it('leaves PINAGENT_AGENT_API_KEY untouched when apiKey is omitted', () => {
      pinagentMiddleware({ projectRoot: root, spawnMode: false });
      expect(process.env.PINAGENT_AGENT_API_KEY).toBeUndefined();
    });

    it('never reads ANTHROPIC_API_KEY / OPENAI_API_KEY implicitly', () => {
      const prevAnthropic = process.env.ANTHROPIC_API_KEY;
      const prevOpenai = process.env.OPENAI_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-anthropic-should-not-leak';
      process.env.OPENAI_API_KEY = 'sk-openai-should-not-leak';
      try {
        pinagentMiddleware({ projectRoot: root, spawnMode: false });
        // No implicit pickup — the explicit option is the only key input.
        expect(process.env.PINAGENT_AGENT_API_KEY).toBeUndefined();
      } finally {
        if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = prevAnthropic;
        if (prevOpenai === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prevOpenai;
      }
    });
  });
});
