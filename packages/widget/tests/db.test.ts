// SPDX-License-Identifier: Apache-2.0
import { conversations, messages, widgetAnchors } from '@pinagent/db/schema';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConversationMessages, listPendingForCurrentPage } from '../src/db/reads';
import {
  type AnchorInput,
  deleteConversation,
  deleteConversationMessages,
  markConversationResolved,
  pruneOldConversations,
  recordConversationStart,
  recordEvent,
  recordUserMessage,
} from '../src/db/writes';
import { openTestDb, type TestDb } from './_helpers/test-db';

let db: TestDb;
let close: () => void;

beforeEach(() => {
  const t = openTestDb();
  db = t.db;
  close = t.close;
});

afterEach(() => {
  close();
});

function anchor(overrides: Partial<AnchorInput> = {}): AnchorInput {
  return {
    url: 'http://localhost:3000/',
    file: 'src/Foo.tsx',
    line: 42,
    col: 7,
    selector: 'main > div > button',
    clickX: 100,
    clickY: 200,
    viewportW: 1280,
    viewportH: 720,
    ...overrides,
  };
}

describe('recordConversationStart', () => {
  it('inserts conversation + widget_anchor rows', async () => {
    await recordConversationStart(db, {
      feedbackId: 'fb-1',
      comment: 'make it red',
      anchor: anchor(),
    });
    const cs = await db.select().from(conversations);
    const as = await db.select().from(widgetAnchors);
    expect(cs).toHaveLength(1);
    expect(cs[0]?.id).toBe('fb-1');
    expect(cs[0]?.comment).toBe('make it red');
    expect(cs[0]?.status).toBe('pending');
    expect(as).toHaveLength(1);
    expect(as[0]?.conversationId).toBe('fb-1');
    expect(as[0]?.selector).toBe('main > div > button');
    expect(as[0]?.clickX).toBe(100);
  });

  it('is idempotent on conflicting feedbackId (re-submit, etc.)', async () => {
    await recordConversationStart(db, { feedbackId: 'fb-1', comment: 'a', anchor: anchor() });
    await recordConversationStart(db, { feedbackId: 'fb-1', comment: 'b', anchor: anchor() });
    const cs = await db.select().from(conversations);
    expect(cs).toHaveLength(1);
    expect(cs[0]?.comment).toBe('a'); // first write wins
  });

  it('persists multi-pick extras into the additional_anchors JSON column', async () => {
    await recordConversationStart(db, {
      feedbackId: 'fb-multi',
      comment: 'these three',
      anchor: anchor({
        additionalAnchors: [
          {
            file: 'src/A.tsx',
            line: 10,
            col: 4,
            selector: '.a',
            clickX: 1,
            clickY: 2,
          },
          {
            file: null,
            line: null,
            col: null,
            selector: '.b',
            clickX: 3,
            clickY: 4,
          },
        ],
      }),
    });
    const [row] = await db.select().from(widgetAnchors);
    expect(row?.additionalAnchors).toEqual([
      { file: 'src/A.tsx', line: 10, col: 4, selector: '.a', clickX: 1, clickY: 2 },
      { file: null, line: null, col: null, selector: '.b', clickX: 3, clickY: 4 },
    ]);
  });

  it('leaves additional_anchors null when the user picked a single element', async () => {
    await recordConversationStart(db, {
      feedbackId: 'fb-single',
      comment: 'just this',
      anchor: anchor(),
    });
    const [row] = await db.select().from(widgetAnchors);
    expect(row?.additionalAnchors).toBeNull();
  });

  it('treats an empty extras array the same as omitting it (null in DB)', async () => {
    await recordConversationStart(db, {
      feedbackId: 'fb-empty',
      comment: 'just this',
      anchor: anchor({ additionalAnchors: [] }),
    });
    const [row] = await db.select().from(widgetAnchors);
    expect(row?.additionalAnchors).toBeNull();
  });
});

describe('recordEvent', () => {
  beforeEach(async () => {
    await recordConversationStart(db, {
      feedbackId: 'fb-1',
      comment: 'hi',
      anchor: anchor(),
    });
  });

  it('appends a message with role=event.type and JSON content', async () => {
    await recordEvent(db, 'fb-1', 1, {
      type: 'init',
      sessionId: 'sess-1',
      model: 'claude',
    });
    const rows = await db.select().from(messages);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('init');
    expect(rows[0]?.turn).toBe(1);
    expect(rows[0]?.content).toMatchObject({ type: 'init', sessionId: 'sess-1' });
  });

  it('touches conversations.updated_at on each event', async () => {
    // Force an older updated_at so we can detect the touch.
    await db.run(sql`UPDATE conversations SET updated_at = 1000 WHERE id = 'fb-1'`);
    await recordEvent(db, 'fb-1', 1, { type: 'text', text: 'hello' });
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, 'fb-1'));
    // Timestamp must be present and much larger than 1000ms-epoch.
    expect(conv?.updatedAt).toBeInstanceOf(Date);
    expect(conv!.updatedAt.getTime()).toBeGreaterThan(2000);
  });

  it('preserves event order via autoincrement id', async () => {
    await recordEvent(db, 'fb-1', 1, { type: 'init', sessionId: 's' });
    await recordEvent(db, 'fb-1', 1, { type: 'text', text: 'one' });
    await recordEvent(db, 'fb-1', 1, { type: 'text', text: 'two' });
    const rows = await getConversationMessages(db, 'fb-1');
    expect(rows.map((r) => r.role)).toEqual(['init', 'text', 'text']);
  });

  it('throws if the conversation does not exist (FK enforced)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        recordEvent(db, 'never-existed', 1, { type: 'text', text: 'x' }),
      ).rejects.toThrow();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('recordUserMessage', () => {
  beforeEach(async () => {
    await recordConversationStart(db, {
      feedbackId: 'fb-1',
      comment: 'hi',
      anchor: anchor(),
    });
  });

  it("inserts with role='user' and { text } JSON content", async () => {
    await recordUserMessage(db, 'fb-1', 2, 'can you also make it bold?');
    const rows = await db.select().from(messages);
    expect(rows[0]?.role).toBe('user');
    expect(rows[0]?.turn).toBe(2);
    expect(rows[0]?.content).toEqual({ text: 'can you also make it bold?' });
  });
});

describe('markConversationResolved', () => {
  beforeEach(async () => {
    await recordConversationStart(db, {
      feedbackId: 'fb-1',
      comment: 'hi',
      anchor: anchor(),
    });
  });

  it('flips status and sets resolvedAt to a real Date', async () => {
    await markConversationResolved(db, 'fb-1', 'fixed');
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, 'fb-1'));
    expect(conv?.status).toBe('fixed');
    expect(conv?.resolvedAt).toBeInstanceOf(Date);
  });

  it("also accepts 'wontfix'", async () => {
    await markConversationResolved(db, 'fb-1', 'wontfix');
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, 'fb-1'));
    expect(conv?.status).toBe('wontfix');
  });

  it('is a no-op when the conversation does not exist (UPDATE matches nothing)', async () => {
    await expect(markConversationResolved(db, 'nope', 'fixed')).resolves.toBeUndefined();
  });
});

describe('deleteConversation', () => {
  beforeEach(async () => {
    await recordConversationStart(db, {
      feedbackId: 'fb-1',
      comment: 'hi',
      anchor: anchor(),
    });
    await recordEvent(db, 'fb-1', 1, { type: 'text', text: 'x' });
  });

  it('cascades to messages and widget_anchors', async () => {
    await deleteConversation(db, 'fb-1');
    expect(await db.select().from(conversations)).toEqual([]);
    expect(await db.select().from(messages)).toEqual([]);
    expect(await db.select().from(widgetAnchors)).toEqual([]);
  });
});

describe('pruneOldConversations', () => {
  it('drops resolved conversations older than 30 days', async () => {
    await recordConversationStart(db, {
      feedbackId: 'old',
      comment: 'old',
      anchor: anchor(),
    });
    await markConversationResolved(db, 'old', 'fixed');
    // Force updated_at to 31 days ago.
    const ancient = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await db.run(sql`UPDATE conversations SET updated_at = ${ancient} WHERE id = 'old'`);

    const dropped = await pruneOldConversations(db);
    expect(dropped).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(conversations)).toEqual([]);
  });

  it('keeps pending conversations even if old', async () => {
    await recordConversationStart(db, {
      feedbackId: 'old-pending',
      comment: '',
      anchor: anchor(),
    });
    const ancient = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await db.run(sql`UPDATE conversations SET updated_at = ${ancient} WHERE id = 'old-pending'`);
    await pruneOldConversations(db);
    expect(await db.select().from(conversations)).toHaveLength(1);
  });

  it('keeps resolved conversations within the TTL window', async () => {
    await recordConversationStart(db, {
      feedbackId: 'recent',
      comment: '',
      anchor: anchor(),
    });
    await markConversationResolved(db, 'recent', 'fixed');
    await pruneOldConversations(db);
    expect(await db.select().from(conversations)).toHaveLength(1);
  });
});

describe('listPendingForCurrentPage', () => {
  it('returns pending conversations for the current url, newest first', async () => {
    await recordConversationStart(db, {
      feedbackId: 'a',
      comment: '',
      anchor: anchor({ url: 'http://localhost:3000/page-a' }),
    });
    await recordConversationStart(db, {
      feedbackId: 'b',
      comment: '',
      anchor: anchor({ url: 'http://localhost:3000/page-a' }),
    });
    // Set b's updated_at to be later so the order is deterministic.
    await db.run(sql`UPDATE conversations SET updated_at = updated_at + 1000 WHERE id = 'b'`);

    const rows = await listPendingForCurrentPage(db, 'http://localhost:3000/page-a');
    expect(rows.map((r) => r.conversation.id)).toEqual(['b', 'a']);
  });

  it('filters out conversations whose anchor.url is a different page', async () => {
    await recordConversationStart(db, {
      feedbackId: 'here',
      comment: '',
      anchor: anchor({ url: 'http://localhost:3000/here' }),
    });
    await recordConversationStart(db, {
      feedbackId: 'there',
      comment: '',
      anchor: anchor({ url: 'http://localhost:3000/there' }),
    });
    const rows = await listPendingForCurrentPage(db, 'http://localhost:3000/here');
    expect(rows.map((r) => r.conversation.id)).toEqual(['here']);
  });

  it('excludes resolved conversations', async () => {
    await recordConversationStart(db, {
      feedbackId: 'done',
      comment: '',
      anchor: anchor(),
    });
    await recordConversationStart(db, {
      feedbackId: 'pending',
      comment: '',
      anchor: anchor(),
    });
    await markConversationResolved(db, 'done', 'fixed');
    const rows = await listPendingForCurrentPage(db, 'http://localhost:3000/');
    expect(rows.map((r) => r.conversation.id)).toEqual(['pending']);
  });
});

describe('getConversationMessages', () => {
  it('returns messages in id order with JSON content parsed', async () => {
    await recordConversationStart(db, {
      feedbackId: 'fb',
      comment: '',
      anchor: anchor(),
    });
    await recordEvent(db, 'fb', 1, { type: 'init', sessionId: 's' });
    await recordUserMessage(db, 'fb', 2, 'hi');
    await recordEvent(db, 'fb', 2, { type: 'text', text: 'reply' });

    const rows = await getConversationMessages(db, 'fb');
    expect(rows.map((r) => r.role)).toEqual(['init', 'user', 'text']);
    expect(rows[1]?.content).toEqual({ text: 'hi' });
    expect(rows[2]?.content).toMatchObject({ type: 'text', text: 'reply' });
  });

  it('returns [] for an unknown id', async () => {
    expect(await getConversationMessages(db, 'never')).toEqual([]);
  });
});

describe('deleteConversationMessages', () => {
  it('drops the conversation’s messages but keeps the conversation row', async () => {
    await recordConversationStart(db, { feedbackId: 'fb', comment: 'c', anchor: anchor() });
    await recordEvent(db, 'fb', 1, { type: 'init', sessionId: 's' });
    await recordEvent(db, 'fb', 1, { type: 'text', text: 'a' });
    await recordUserMessage(db, 'fb', 1, 'hi');
    expect(await getConversationMessages(db, 'fb')).toHaveLength(3);

    await deleteConversationMessages(db, 'fb');

    // Messages gone; the conversation row (and anchor) survive so the
    // reconnect replay can re-record into the same conversation.
    expect(await getConversationMessages(db, 'fb')).toEqual([]);
    const cs = await db.select().from(conversations).where(eq(conversations.id, 'fb'));
    expect(cs).toHaveLength(1);
    const as = await db.select().from(widgetAnchors).where(eq(widgetAnchors.conversationId, 'fb'));
    expect(as).toHaveLength(1);
  });

  it('leaves other conversations’ messages untouched', async () => {
    await recordConversationStart(db, { feedbackId: 'a', comment: '', anchor: anchor() });
    await recordConversationStart(db, { feedbackId: 'b', comment: '', anchor: anchor() });
    await recordEvent(db, 'a', 1, { type: 'text', text: 'a1' });
    await recordEvent(db, 'b', 1, { type: 'text', text: 'b1' });

    await deleteConversationMessages(db, 'a');

    expect(await getConversationMessages(db, 'a')).toEqual([]);
    expect(await getConversationMessages(db, 'b')).toHaveLength(1);
  });
});
