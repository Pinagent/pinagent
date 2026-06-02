// SPDX-License-Identifier: Apache-2.0
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, BusSubscriber } from '@pinagent/shared';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Unit tests for the SQLite-backed event bus (src/bus.ts).
 *
 * The bus is the source of truth for the agent event stream — it INSERTs
 * every publish into the `messages` table and subscribers poll it (see the
 * file header in bus.ts for why this is SQLite and not in-memory). These
 * tests exercise the contracts the WS server and widget depend on:
 * replay-to-late-subscriber, live delivery, the `__finished` sentinel,
 * subscriber-error isolation, and cross-instance delivery via the shared DB.
 *
 * Delivery is poll-driven (POLL_INTERVAL_MS = 100), so assertions wait on a
 * predicate rather than a fixed sleep.
 */

const PROJECT_ROOT = join(tmpdir(), `pa-bus-${nanoid(8)}`);

type BusMod = typeof import('../src/bus');
type StorageMod = typeof import('../src/storage');

let busMod: BusMod;
let storage: InstanceType<StorageMod['Storage']>;

/**
 * The bus INSERTs into `messages`, which has a FK on `conversations.id`.
 * Without a parent row, `publish` silently drops the event (FK violation).
 * Materialise a conversation so published events stick.
 */
async function ensureConversation(id: string): Promise<void> {
  await storage.create(id, {
    comment: 'bus test fixture',
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

async function waitFor(
  predicate: () => boolean,
  { timeout = 2000, interval = 20 } = {},
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor: predicate did not become true within timeout');
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Collecting subscriber that records every event and onClose call. */
function collector(): BusSubscriber & { events: AgentEvent[]; closed: number } {
  const events: AgentEvent[] = [];
  let closed = 0;
  return {
    events,
    get closed() {
      return closed;
    },
    onEvent(event) {
      events.push(event);
    },
    onClose() {
      closed++;
    },
  };
}

const textEvent = (text: string): AgentEvent => ({ type: 'text', text }) as AgentEvent;

beforeAll(async () => {
  process.env.PINAGENT_PROJECT_ROOT = PROJECT_ROOT;
  await mkdir(PROJECT_ROOT, { recursive: true });
  busMod = await import('../src/bus');
  const storageMod = await import('../src/storage');
  storage = new storageMod.Storage(PROJECT_ROOT);
});

afterAll(async () => {
  await rm(PROJECT_ROOT, { recursive: true, force: true });
});

let feedbackId: string;
beforeEach(() => {
  // Unique id per test so the global bus cache and the message rows from one
  // test never bleed into another.
  feedbackId = nanoid(10);
});

describe('SqliteEventBus', () => {
  it('replays events published before subscribe to a late subscriber', async () => {
    await ensureConversation(feedbackId);
    const bus = busMod.getOrCreateBus(feedbackId, PROJECT_ROOT);
    await bus.publish(textEvent('one'));
    await bus.publish(textEvent('two'));

    const sub = collector();
    const stop = bus.subscribe(sub);
    await waitFor(() => sub.events.length >= 2);
    stop();

    expect(sub.events.map((e) => (e as { text: string }).text)).toEqual(['one', 'two']);
  });

  it('delivers events published after subscribe, in id order', async () => {
    await ensureConversation(feedbackId);
    const bus = busMod.getOrCreateBus(feedbackId, PROJECT_ROOT);
    const sub = collector();
    const stop = bus.subscribe(sub);

    await bus.publish(textEvent('a'));
    await bus.publish(textEvent('b'));
    await bus.publish(textEvent('c'));
    await waitFor(() => sub.events.length >= 3);
    stop();

    expect(sub.events.map((e) => (e as { text: string }).text)).toEqual(['a', 'b', 'c']);
  });

  it('calls onClose exactly once on finish and does not deliver the sentinel as an event', async () => {
    await ensureConversation(feedbackId);
    const bus = busMod.getOrCreateBus(feedbackId, PROJECT_ROOT);
    const sub = collector();
    bus.subscribe(sub);

    await bus.publish(textEvent('before-finish'));
    await waitFor(() => sub.events.length >= 1);
    await busMod.finishBus(feedbackId);
    await waitFor(() => sub.closed >= 1);

    // Give a couple more poll cycles a chance to (wrongly) re-fire onClose
    // or deliver the sentinel row as an event.
    await new Promise((r) => setTimeout(r, 250));
    expect(sub.closed).toBe(1);
    expect(sub.events.map((e) => (e as { text: string }).text)).toEqual(['before-finish']);
  });

  it('keeps delivering after a subscriber throws on one event', async () => {
    await ensureConversation(feedbackId);
    const bus = busMod.getOrCreateBus(feedbackId, PROJECT_ROOT);
    const seen: string[] = [];
    const stop = bus.subscribe({
      onEvent(event) {
        const text = (event as { text: string }).text;
        seen.push(text);
        if (text === 'boom') throw new Error('subscriber blew up');
      },
      onClose() {},
    });

    await bus.publish(textEvent('ok-1'));
    await bus.publish(textEvent('boom'));
    await bus.publish(textEvent('ok-2'));
    await waitFor(() => seen.length >= 3);
    stop();

    expect(seen).toEqual(['ok-1', 'boom', 'ok-2']);
  });

  it('stops delivering events after the returned disposer is called', async () => {
    await ensureConversation(feedbackId);
    const bus = busMod.getOrCreateBus(feedbackId, PROJECT_ROOT);
    const sub = collector();
    const stop = bus.subscribe(sub);

    await bus.publish(textEvent('kept'));
    await waitFor(() => sub.events.length >= 1);
    stop();

    await bus.publish(textEvent('dropped'));
    await new Promise((r) => setTimeout(r, 250));
    expect(sub.events.map((e) => (e as { text: string }).text)).toEqual(['kept']);
  });

  it('swallows a publish when no conversation row exists (FK violation)', async () => {
    // No ensureConversation — the parent row is missing.
    const bus = busMod.getOrCreateBus(feedbackId, PROJECT_ROOT);
    await expect(bus.publish(textEvent('orphan'))).resolves.toBeUndefined();

    const sub = collector();
    const stop = bus.subscribe(sub);
    await new Promise((r) => setTimeout(r, 250));
    stop();
    expect(sub.events).toHaveLength(0);
  });

  it('delivers events across two bus instances over the shared SQLite file', async () => {
    await ensureConversation(feedbackId);
    // Two distinct instances (not the cached singleton) backed by the same DB.
    const writer = new busMod.SqliteEventBus(feedbackId, PROJECT_ROOT);
    const reader = new busMod.SqliteEventBus(feedbackId, PROJECT_ROOT);

    const sub = collector();
    const stop = reader.subscribe(sub);
    await writer.publish(textEvent('cross-context'));
    await waitFor(() => sub.events.length >= 1);
    stop();

    expect((sub.events[0] as { text: string }).text).toBe('cross-context');
  });
});

describe('bus cache (getOrCreateBus / getBus / finishBus)', () => {
  it('returns the same instance for the same feedback id', () => {
    const a = busMod.getOrCreateBus(feedbackId, PROJECT_ROOT);
    const b = busMod.getOrCreateBus(feedbackId, PROJECT_ROOT);
    expect(a).toBe(b);
    expect(busMod.getBus(feedbackId)).toBe(a);
  });

  it('evicts the cached instance after finishBus', async () => {
    await ensureConversation(feedbackId);
    busMod.getOrCreateBus(feedbackId, PROJECT_ROOT);
    expect(busMod.getBus(feedbackId)).toBeDefined();

    await busMod.finishBus(feedbackId);
    expect(busMod.getBus(feedbackId)).toBeUndefined();
  });

  it('finishBus on an unknown feedback id is a no-op', async () => {
    await expect(busMod.finishBus('never-created')).resolves.toBeUndefined();
  });
});
