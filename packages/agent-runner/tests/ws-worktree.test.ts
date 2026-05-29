// SPDX-License-Identifier: Apache-2.0
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

/**
 * Phase H WS round-trip: `land_request` / `discard_request` from the
 * client cause the server to dispatch into `agent.mergeWorktree` /
 * `agent.discardWorktree` and broadcast `worktree_state` frames back
 * to every subscriber.
 *
 * Real WS server + real `ws` client; agent module is mocked so the
 * tests stay focused on protocol behaviour. End-to-end git is covered
 * by `agent-merge.test.ts`.
 */

const TEST_PORT = 53701;
// `startWsServer` falls back to the next free port if 53701 is busy, so we
// connect to the actually-bound port it returns (set in beforeAll) rather
// than the requested one — otherwise the client gets ECONNREFUSED.
let WS_URL: string;

const SINGLETON_KEY = Symbol.for('pinagent.ws-server');
const WT_SUBS_KEY = Symbol.for('pinagent.ws.worktreeSubs');
const QUEUES_KEY = Symbol.for('pinagent.merge-queue.tails');

const ROOT = join(tmpdir(), `pa-wsh-${nanoid(8)}`);

// Scripted responses for the mocked merge/discard. Each test rewrites
// these before sending its request.
let nextMerge: () => Promise<unknown> = async () => ({ ok: true, commitSha: 'a'.repeat(40) });
let nextDiscard: () => Promise<unknown> = async () => ({ ok: true });

vi.mock('../src/agent', async () => {
  const actual = await vi.importActual<typeof import('../src/agent')>('../src/agent');
  return {
    ...actual,
    mergeWorktree: vi.fn(async (..._a: unknown[]) => nextMerge()),
    discardWorktree: vi.fn(async (..._a: unknown[]) => nextDiscard()),
  };
});

type ServerMod = typeof import('../src/ws-server');
type StorageMod = typeof import('../src/storage');

let server: ServerMod;
let storageMod: StorageMod;

beforeAll(async () => {
  process.env.PINAGENT_WS_PORT = String(TEST_PORT);
  process.env.PINAGENT_PROJECT_ROOT = ROOT;
  process.env.PINAGENT_WORKTREE_TTL_DAYS = '0'; // disable startup sweep
  process.env.NODE_ENV = 'production';
  (globalThis as Record<symbol, unknown>)[SINGLETON_KEY] = undefined;
  (globalThis as Record<symbol, unknown>)[WT_SUBS_KEY] = undefined;
  (globalThis as Record<symbol, unknown>)[QUEUES_KEY] = undefined;

  await mkdir(ROOT, { recursive: true });
  server = await import('../src/ws-server');
  storageMod = await import('../src/storage');

  const handle = await server.startWsServer();
  WS_URL = `ws://127.0.0.1:${handle.port}/__pinagent/ws`;
});

afterAll(async () => {
  const handle = (globalThis as Record<symbol, { wss?: { close: () => void } }>)[SINGLETON_KEY];
  handle?.wss?.close();
  (globalThis as Record<symbol, unknown>)[SINGLETON_KEY] = undefined;
  await rm(ROOT, { recursive: true, force: true });
});

class TestClient {
  readonly messages: unknown[] = [];
  readonly opened: Promise<void>;
  private readonly ws: WebSocket;
  private waiters: Array<(m: unknown) => void> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw: Buffer) => {
      const m = JSON.parse(raw.toString('utf8'));
      this.messages.push(m);
      const ws = this.waiters;
      this.waiters = [];
      for (const w of ws) w(m);
    });
  }

  send(obj: object) {
    this.ws.send(JSON.stringify(obj));
  }

  async waitFor(predicate: (m: unknown) => boolean, timeoutMs = 1500): Promise<unknown> {
    const buffered = this.messages.find(predicate);
    if (buffered) return buffered;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('waitFor timed out')), timeoutMs);
      const onMsg = (m: unknown) => {
        if (predicate(m)) {
          clearTimeout(t);
          resolve(m);
        } else {
          this.waiters.push(onMsg);
        }
      };
      this.waiters.push(onMsg);
    });
  }

  close() {
    this.ws.close();
  }
}

const clients: TestClient[] = [];
function newClient(): TestClient {
  const c = new TestClient(WS_URL);
  clients.push(c);
  return c;
}

beforeEach(() => {
  // Drop any leftover clients from the previous test.
  for (const c of clients) c.close();
  clients.length = 0;
});

async function makeRow(state: 'active' | 'none' = 'active'): Promise<string> {
  const id = nanoid(10);
  const storage = new storageMod.Storage(ROOT);
  await storage.create(id, {
    comment: 'hi',
    loc: { file: 'src/x.tsx', line: 1, col: 1 },
    selector: 'h1',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest',
    screenshot:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    createdAt: new Date().toISOString(),
  });
  if (state === 'active') {
    await storage.patch(id, {
      worktreeState: 'active',
      branch: `pinagent/${id}`,
      worktreePath: join(ROOT, '.pinagent', 'worktrees', id),
    });
  }
  return id;
}

describe('ws-server — worktree lifecycle', () => {
  it('emits current worktree state on subscribe', async () => {
    const id = await makeRow('active');
    const c = newClient();
    await c.opened;
    c.send({ type: 'subscribe', feedbackId: id });

    const msg = (await c.waitFor(
      (m) =>
        (m as { type?: string; feedbackId?: string }).type === 'worktree_state' &&
        (m as { feedbackId?: string }).feedbackId === id,
    )) as { state: string };
    expect(msg.state).toBe('active');
  });

  it('round-trips land_request → landing → landed with commit sha', async () => {
    const id = await makeRow('active');
    nextMerge = async () => ({ ok: true, commitSha: 'deadbeef'.repeat(5) });

    const c = newClient();
    await c.opened;
    c.send({ type: 'subscribe', feedbackId: id });
    // Drain the initial 'active' broadcast so subsequent waitFor's see
    // the new state, not the cached initial one.
    await c.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'active',
    );

    c.send({ type: 'land_request', feedbackId: id });

    const landing = (await c.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'landing',
    )) as { feedbackId: string };
    expect(landing.feedbackId).toBe(id);

    const landed = (await c.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'landed',
    )) as { commitSha?: string };
    expect(landed.commitSha).toBe('deadbeef'.repeat(5));
  });

  it('round-trips land_request → landing → conflict with file list', async () => {
    const id = await makeRow('active');
    nextMerge = async () => ({ ok: false, conflicts: ['src/x.tsx', 'README.md'] });

    const c = newClient();
    await c.opened;
    c.send({ type: 'subscribe', feedbackId: id });
    await c.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'active',
    );

    c.send({ type: 'land_request', feedbackId: id });

    const conflict = (await c.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'conflict',
    )) as { conflicts?: string[] };
    expect(conflict.conflicts).toEqual(['src/x.tsx', 'README.md']);
  });

  it('reverts to active when land fails for a non-conflict reason', async () => {
    const id = await makeRow('active');
    nextMerge = async () => ({ ok: false, error: 'project HEAD is detached' });

    const c = newClient();
    await c.opened;
    c.send({ type: 'subscribe', feedbackId: id });
    await c.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'active',
    );

    c.send({ type: 'land_request', feedbackId: id });

    // landing first
    await c.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'landing',
    );
    // …then back to active with the error message attached.
    const recovered = (await c.waitFor(
      (m) =>
        (m as { type?: string; state?: string; message?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'active' &&
        typeof (m as { message?: string }).message === 'string',
    )) as { message: string };
    expect(recovered.message).toMatch(/detached/);
  });

  it('round-trips discard_request → discarding → discarded', async () => {
    const id = await makeRow('active');
    nextDiscard = async () => ({ ok: true });

    const c = newClient();
    await c.opened;
    c.send({ type: 'subscribe', feedbackId: id });
    await c.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'active',
    );

    c.send({ type: 'discard_request', feedbackId: id });

    await c.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'discarding',
    );
    const discarded = (await c.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'discarded',
    )) as { feedbackId: string };
    expect(discarded.feedbackId).toBe(id);
  });

  it('broadcasts worktree_state to every subscriber of the same feedback id', async () => {
    const id = await makeRow('active');
    nextDiscard = async () => ({ ok: true });

    const a = newClient();
    const b = newClient();
    await Promise.all([a.opened, b.opened]);
    a.send({ type: 'subscribe', feedbackId: id });
    b.send({ type: 'subscribe', feedbackId: id });
    await a.waitFor((m) => (m as { type?: string }).type === 'worktree_state');
    await b.waitFor((m) => (m as { type?: string }).type === 'worktree_state');

    a.send({ type: 'discard_request', feedbackId: id });

    const onA = await a.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'discarded',
    );
    const onB = await b.waitFor(
      (m) =>
        (m as { type?: string; state?: string }).type === 'worktree_state' &&
        (m as { state?: string }).state === 'discarded',
    );
    expect((onA as { feedbackId: string }).feedbackId).toBe(id);
    expect((onB as { feedbackId: string }).feedbackId).toBe(id);
  });
});
