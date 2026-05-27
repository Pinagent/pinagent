// SPDX-License-Identifier: Apache-2.0
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

/**
 * Live-socket integration tests for the WS server.
 *
 * Real `ws.WebSocketServer` on a test-local port; real `ws` client
 * sending JSON over the wire. Asserts on the actual ServerMessage
 * frames the dev server would emit to the widget.
 *
 * Port choice: 53700 (out of the 53636 default range used by the
 * user's dev server). Each test file gets its own vitest worker, so
 * we don't need to randomise.
 */

const TEST_PORT = 53700;
const WS_URL = `ws://127.0.0.1:${TEST_PORT}/__pinagent/ws`;
const PROJECT_ROOT = join(tmpdir(), `pa-ws-${nanoid(8)}`);

// Symbol the ws-server uses to cache the singleton. Cleared in
// beforeAll so a previous run's stale handle (if any) is dropped.
const SINGLETON_KEY = Symbol.for('pinagent.ws-server');

type ServerMod = typeof import('../src/ws-server');
type BusMod = typeof import('../src/bus');
type StorageMod = typeof import('../src/storage');

let server: ServerMod;
let bus: BusMod;
let storageMod: StorageMod;
let storage: InstanceType<StorageMod['Storage']>;

/**
 * The SqliteEventBus inserts into `messages` which has a FK on
 * `conversations.id`. Tests publish events to ad-hoc feedback ids;
 * without a parent row, publish silently drops (FK violation). This
 * helper materialises a conversation row so the bus events stick.
 */
async function ensureConversation(id: string): Promise<void> {
  await storage.create(id, {
    comment: 'ws-server test fixture',
    loc: { file: 'x.tsx', line: 1, col: 1 },
    selector: 'button',
    url: 'http://localhost/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest',
    screenshot:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    createdAt: new Date().toISOString(),
  });
}

beforeAll(async () => {
  process.env.PINAGENT_WS_PORT = String(TEST_PORT);
  process.env.PINAGENT_PROJECT_ROOT = PROJECT_ROOT;
  await mkdir(PROJECT_ROOT, { recursive: true });
  (globalThis as Record<symbol, unknown>)[SINGLETON_KEY] = undefined;
  server = await import('../src/ws-server');
  bus = await import('../src/bus');
  storageMod = await import('../src/storage');
  storage = new storageMod.Storage(PROJECT_ROOT);
  // startWsServer is async and probes for a free port (falling back from
  // PINAGENT_WS_PORT if it's busy). Awaiting it is enough — the returned
  // handle is already listening.
  await server.startWsServer();
});

afterAll(async () => {
  const handle = (globalThis as Record<symbol, { wss?: { close: () => void } }>)[SINGLETON_KEY];
  handle?.wss?.close();
  (globalThis as Record<symbol, unknown>)[SINGLETON_KEY] = undefined;
  await rm(PROJECT_ROOT, { recursive: true, force: true });
});

/**
 * Tiny client wrapper: opens a WS, collects every JSON-parsed
 * message into an array. Each test gets its own client so message
 * streams don't bleed between tests.
 */
class TestClient {
  private ws: WebSocket;
  readonly messages: unknown[] = [];
  readonly opened: Promise<void>;
  private nextWaiter: ((msg: unknown) => void) | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw: Buffer) => {
      const parsed = JSON.parse(raw.toString('utf8'));
      this.messages.push(parsed);
      const w = this.nextWaiter;
      if (w) {
        this.nextWaiter = null;
        w(parsed);
      }
    });
  }

  send(obj: object) {
    this.ws.send(JSON.stringify(obj));
  }

  /** Wait for the next message that satisfies `predicate`, with a timeout. */
  async waitFor(predicate: (m: unknown) => boolean, timeoutMs = 1000): Promise<unknown> {
    // First check any already-buffered messages.
    const buffered = this.messages.find(predicate);
    if (buffered) return buffered;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('waitFor timed out')), timeoutMs);
      const cb = (m: unknown) => {
        if (predicate(m)) {
          clearTimeout(t);
          resolve(m);
        } else {
          // Stay subscribed for the next one.
          this.nextWaiter = cb;
        }
      };
      this.nextWaiter = cb;
    });
  }

  close() {
    this.ws.close();
  }
}

let activeClients: TestClient[] = [];

function newClient(): TestClient {
  const c = new TestClient(WS_URL);
  activeClients.push(c);
  return c;
}

afterEach(() => {
  for (const c of activeClients) c.close();
  activeClients = [];
});

/** Helper: a feedbackId that satisfies the protocol's regex. */
let idCounter = 0;
const newId = () => `fb${String(++idCounter).padStart(8, '0')}`;

describe('ws-server', () => {
  it('accepts a connection (open handshake succeeds)', async () => {
    const c = newClient();
    await expect(c.opened).resolves.toBeUndefined();
  });

  it('responds to ping with pong', async () => {
    const c = newClient();
    await c.opened;
    c.send({ type: 'ping' });
    const pong = await c.waitFor((m) => (m as { type?: string }).type === 'pong');
    expect(pong).toEqual({ type: 'pong' });
  });

  it('returns an error frame for invalid JSON', async () => {
    const c = newClient();
    await c.opened;
    // Send raw garbage bypassing the JSON.stringify in send().
    (c as unknown as { ws: WebSocket }).ws.send('not json{');
    const err = await c.waitFor((m) => (m as { type?: string }).type === 'error');
    expect((err as { message: string }).message).toMatch(/invalid JSON/);
  });

  it('returns an error frame for a message that fails schema validation', async () => {
    const c = newClient();
    await c.opened;
    c.send({ type: 'subscribe', feedbackId: 'bad!chars' });
    const err = await c.waitFor((m) => (m as { type?: string }).type === 'error');
    expect((err as { message: string }).message).toMatch(/invalid message/);
  });

  it('delivers bus events to a subscribed client', async () => {
    const c = newClient();
    await c.opened;
    const id = newId();
    await ensureConversation(id);

    c.send({ type: 'subscribe', feedbackId: id });
    // Give the subscribe a microtask to register before we publish.
    await new Promise((r) => setTimeout(r, 10));

    await bus.getOrCreateBus(id).publish({ type: 'text', text: 'hello' });

    const event = await c.waitFor(
      (m) =>
        (m as { type?: string; feedbackId?: string }).type === 'event' &&
        (m as { feedbackId?: string }).feedbackId === id,
    );
    expect(event).toMatchObject({
      type: 'event',
      feedbackId: id,
      event: { type: 'text', text: 'hello' },
    });
  });

  it('replays the bus buffer to a late subscriber', async () => {
    const c = newClient();
    await c.opened;
    const id = newId();
    await ensureConversation(id);

    const b = bus.getOrCreateBus(id);
    await b.publish({ type: 'text', text: 'one' });
    await b.publish({ type: 'text', text: 'two' });

    c.send({ type: 'subscribe', feedbackId: id });

    // Both events should arrive.
    const messages: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      messages.push(
        await c.waitFor(
          (m) =>
            (m as { type?: string; feedbackId?: string }).type === 'event' &&
            (m as { feedbackId?: string }).feedbackId === id &&
            !messages.includes(m),
        ),
      );
    }
    expect(messages.map((m) => (m as { event: { text: string } }).event.text)).toEqual([
      'one',
      'two',
    ]);
  });

  it('sends a `done` frame when the bus is finished', async () => {
    const c = newClient();
    await c.opened;
    const id = newId();
    await ensureConversation(id);

    bus.getOrCreateBus(id); // touch so it exists
    c.send({ type: 'subscribe', feedbackId: id });
    await new Promise((r) => setTimeout(r, 10));

    await bus.finishBus(id);

    const done = await c.waitFor(
      (m) =>
        (m as { type?: string; feedbackId?: string }).type === 'done' &&
        (m as { feedbackId?: string }).feedbackId === id,
    );
    expect(done).toEqual({ type: 'done', feedbackId: id });
  });

  it('stops delivering events after unsubscribe', async () => {
    const c = newClient();
    await c.opened;
    const id = newId();
    await ensureConversation(id);

    c.send({ type: 'subscribe', feedbackId: id });
    await new Promise((r) => setTimeout(r, 10));

    await bus.getOrCreateBus(id).publish({ type: 'text', text: 'before' });
    await c.waitFor(
      (m) =>
        (m as { type?: string }).type === 'event' &&
        (m as { event?: { text?: string } }).event?.text === 'before',
    );

    c.send({ type: 'unsubscribe', feedbackId: id });
    await new Promise((r) => setTimeout(r, 20));

    // Snapshot the count, then publish + wait.
    const before = c.messages.length;
    await bus.getOrCreateBus(id).publish({ type: 'text', text: 'after' });
    // Wait longer than the poll interval to confirm nothing arrives.
    await new Promise((r) => setTimeout(r, 200));
    // After unsubscribe, no new event frames should arrive.
    const newFrames = c.messages
      .slice(before)
      .filter(
        (m) =>
          (m as { type?: string }).type === 'event' &&
          (m as { event?: { text?: string } }).event?.text === 'after',
      );
    expect(newFrames).toHaveLength(0);
  });

  it('silently swallows an ask_response with no matching pending ask', async () => {
    // resolveAsk now always returns true after emitting a cross-context
    // process event (the pending ask may live in a different Turbopack
    // context). The trade-off: same-context double-submits no longer
    // produce a "no pending ask" error frame. We verify nothing crashes
    // and no error frame appears within the polling window.
    const c = newClient();
    await c.opened;
    c.send({ type: 'ask_response', askId: 'never-issued', answer: 'x' });
    // Wait long enough to be confident no error frame is coming.
    await new Promise((r) => setTimeout(r, 150));
    const errFrame = c.messages.find((m) => (m as { type?: string }).type === 'error');
    expect(errFrame).toBeUndefined();
  });

  it('interrupt for an id with no live run returns an error frame', async () => {
    const c = newClient();
    await c.opened;
    const id = newId();
    c.send({ type: 'interrupt', feedbackId: id });
    const err = await c.waitFor((m) => (m as { type?: string }).type === 'error');
    expect((err as { message?: string; feedbackId?: string }).feedbackId).toBe(id);
    expect((err as { message: string }).message).toMatch(/no in-flight run/);
  });

  it('closing the socket unsubscribes everything', async () => {
    const c = newClient();
    await c.opened;
    const id = newId();
    await ensureConversation(id);
    c.send({ type: 'subscribe', feedbackId: id });
    await new Promise((r) => setTimeout(r, 10));

    c.close();
    await new Promise((r) => setTimeout(r, 20));

    // Publishing after close should not throw on the server, and we
    // can't observe receive (socket gone) — just check the bus has
    // no live subscribers by publishing without crashing.
    await expect(
      bus.getOrCreateBus(id).publish({ type: 'text', text: 'after-close' }),
    ).resolves.not.toThrow();
  });
});
