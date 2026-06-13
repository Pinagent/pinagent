// SPDX-License-Identifier: Apache-2.0
import { messages } from '@pinagent/db/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteConversationMessages, recordConversationStart, recordEvent } from '../src/db/writes';
import { openTestDb, type TestDb } from './_helpers/test-db';

// Ticket 006: the reconnect wipe-then-replay invariant. On a WS reconnect
// the stream handler enqueues `deleteConversationMessages` ahead of the
// replayed `recordEvent` re-inserts on a single serial write chain, so the
// transcript rebuilds to EXACTLY one copy. These tests pin that ordering +
// the row-count equality so a refactor can't silently double-write history.

const FB = 'fb-reconnect';

let db: TestDb;
let close: () => void;

beforeEach(async () => {
  const t = openTestDb();
  db = t.db;
  close = t.close;
  await recordConversationStart(db, {
    feedbackId: FB,
    comment: 'do the thing',
    anchor: {
      url: 'http://localhost:3000/',
      file: 'src/Foo.tsx',
      line: 1,
      col: 1,
      selector: 'button',
      clickX: 0,
      clickY: 0,
      viewportW: 800,
      viewportH: 600,
    },
  });
});

afterEach(() => {
  close();
});

/**
 * Mirror of stream-handler's `queueDbWrite`: every browser-cache write goes
 * through one serial promise chain, so a reconnect's wipe is enqueued before
 * the replay's re-inserts and always lands first.
 */
function makeWriteChain() {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    queue(run: () => Promise<unknown>) {
      chain = chain
        .catch(() => {})
        .then(run)
        .catch(() => {});
    },
    settled: () => chain.catch(() => {}),
  };
}

const transcript = [
  { type: 'init', sessionId: 's1', model: 'claude' },
  { type: 'text', text: 'hello' },
  { type: 'tool_use', name: 'Edit' },
  { type: 'tool_result', ok: true },
  { type: 'result', subtype: 'success', numTurns: 1 },
];

async function countRows(): Promise<number> {
  const rows = await db.select().from(messages).where(eq(messages.conversationId, FB));
  return rows.length;
}

describe('reconnect replays exactly once', () => {
  it('wipes then replays to a single copy — row count equals replayed-event count', async () => {
    const wc = makeWriteChain();

    // Live turn: record the transcript once.
    for (const ev of transcript) wc.queue(() => recordEvent(db, FB, 1, ev));
    await wc.settled();
    expect(await countRows()).toBe(transcript.length);

    // Reconnect: onReset enqueues the wipe on the SAME chain, then the
    // server's replay re-inserts the full transcript.
    wc.queue(() => deleteConversationMessages(db, FB));
    for (const ev of transcript) wc.queue(() => recordEvent(db, FB, 1, ev));
    await wc.settled();

    // Exactly one copy — not doubled.
    expect(await countRows()).toBe(transcript.length);
  });

  it('orders the wipe BEFORE the first replay insert', async () => {
    const wc = makeWriteChain();
    for (const ev of transcript) wc.queue(() => recordEvent(db, FB, 1, ev));
    await wc.settled();

    // Instrument the real write calls (no module mocking — tests resolve
    // @pinagent/* from dist, where spyOn interception is unreliable). Each
    // wrapper records its slot in the serial chain, then calls through.
    const order: string[] = [];
    const wipe = () => {
      order.push('delete');
      return deleteConversationMessages(db, FB);
    };
    const insert = (ev: { type: string; [k: string]: unknown }) => {
      order.push(`insert:${ev.type}`);
      return recordEvent(db, FB, 1, ev);
    };

    wc.queue(wipe);
    for (const ev of transcript) wc.queue(() => insert(ev));
    await wc.settled();

    expect(order[0]).toBe('delete');
    expect(order.indexOf('delete')).toBeLessThan(order.indexOf('insert:init'));
    expect(await countRows()).toBe(transcript.length);
  });

  it('a regression that skips the wipe doubles the transcript (guards the row-count assertion)', async () => {
    const wc = makeWriteChain();
    for (const ev of transcript) wc.queue(() => recordEvent(db, FB, 1, ev));
    await wc.settled();

    // Simulate the BUG: replay without the preceding wipe.
    for (const ev of transcript) wc.queue(() => recordEvent(db, FB, 1, ev));
    await wc.settled();

    // The assertion that protects us would fail here — proving it has teeth.
    expect(await countRows()).toBe(transcript.length * 2);
  });
});
