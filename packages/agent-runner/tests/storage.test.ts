// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type FeedbackInput,
  FeedbackInputSchema,
  isInGitignore,
  isInsideRoot,
  Storage,
} from '../src/storage';

// 1x1 transparent PNG.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function makeInput(overrides: Partial<FeedbackInput> = {}): FeedbackInput {
  return {
    comment: 'make it red',
    loc: { file: 'src/Foo.tsx', line: 42, col: 7 },
    selector: 'main > div > button',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'test-agent',
    screenshot: TINY_PNG_B64,
    createdAt: '2026-05-25T12:00:00.000Z',
    ...overrides,
  };
}

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `pa-storage-${nanoid(8)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Storage', () => {
  it('round-trips create → read', async () => {
    const s = new Storage(root);
    const id = nanoid(10);
    const created = await s.create(id, makeInput());
    expect(created.id).toBe(id);
    expect(created.status).toBe('pending');
    expect(created.note).toBeNull();
    expect(created.commitSha).toBeNull();
    expect(created.agentSessionId).toBeNull();
    expect(created.resolvedAt).toBeNull();
    expect(created.additionalAnchors).toBeNull();

    const read = await s.read(id);
    expect(read).toEqual(created);
  });

  it('round-trips multi-pick extras through create → read', async () => {
    const s = new Storage(root);
    const id = nanoid(10);
    const extras = [
      { file: 'src/A.tsx', line: 10, col: 4, selector: '.a', clickX: 1, clickY: 2 },
      { file: null, line: null, col: null, selector: '.b', clickX: 3, clickY: 4 },
    ];
    const created = await s.create(id, makeInput({ additionalAnchors: extras }));
    expect(created.additionalAnchors).toEqual(extras);
    const read = await s.read(id);
    expect(read?.additionalAnchors).toEqual(extras);
  });

  it('defaults component/instance fields to null for single-pick input', async () => {
    const s = new Storage(root);
    const id = nanoid(10);
    const created = await s.create(id, makeInput());
    expect(created.component).toBeNull();
    expect(created.componentPath).toBeNull();
    expect(created.instanceIndex).toBeNull();
    expect(created.instanceTotal).toBeNull();
    expect(created.instanceFingerprint).toBeNull();
  });

  it('round-trips enclosing-component + loop-instance context', async () => {
    const s = new Storage(root);
    const id = nanoid(10);
    const created = await s.create(
      id,
      makeInput({
        component: 'PriceCard',
        componentPath: ['App', 'PriceList', 'PriceCard'],
        instance: { index: 2, total: 5, fingerprint: 'li "Premium" data-testid=card' },
      }),
    );
    expect(created.component).toBe('PriceCard');
    expect(created.componentPath).toEqual(['App', 'PriceList', 'PriceCard']);
    expect(created.instanceIndex).toBe(2);
    expect(created.instanceTotal).toBe(5);
    expect(created.instanceFingerprint).toBe('li "Premium" data-testid=card');

    const read = await s.read(id);
    expect(read).toEqual(created);
  });

  it('create writes the screenshot under .pinagent/screenshots/<id>.png', async () => {
    const s = new Storage(root);
    const id = nanoid(10);
    await s.create(id, makeInput());
    const pngPath = join(root, '.pinagent', 'screenshots', `${id}.png`);
    expect(existsSync(pngPath)).toBe(true);
  });

  it('readScreenshotBase64 returns the same bytes that went in', async () => {
    const s = new Storage(root);
    const id = nanoid(10);
    const rec = await s.create(id, makeInput());
    const out = await s.readScreenshotBase64(rec);
    expect(out).toBe(TINY_PNG_B64);
  });

  it('list returns nothing when no records exist', async () => {
    const s = new Storage(root);
    expect(await s.list()).toEqual([]);
  });

  it('list returns records sorted by createdAt ascending', async () => {
    const s = new Storage(root);
    await s.create(nanoid(10), makeInput({ createdAt: '2026-05-25T12:00:02.000Z' }));
    await s.create(nanoid(10), makeInput({ createdAt: '2026-05-25T12:00:00.000Z' }));
    await s.create(nanoid(10), makeInput({ createdAt: '2026-05-25T12:00:01.000Z' }));
    const list = await s.list();
    expect(list.map((r) => r.createdAt)).toEqual([
      '2026-05-25T12:00:00.000Z',
      '2026-05-25T12:00:01.000Z',
      '2026-05-25T12:00:02.000Z',
    ]);
  });

  // Note: the flat-JSON `.tmp` atomic-write tests that used to live
  // here were dropped when Storage migrated to SQLite. SQLite handles
  // its own atomicity; the directory layout no longer has half-written
  // JSON files to skip.

  it('read returns null for an invalid id (no filesystem hit)', async () => {
    const s = new Storage(root);
    expect(await s.read('!')).toBeNull();
    expect(await s.read('')).toBeNull();
    expect(await s.read('short')).toBeNull();
  });

  it('read returns null when the file does not exist', async () => {
    const s = new Storage(root);
    expect(await s.read('aBcDeFgHiJ')).toBeNull();
  });

  it('read normalises missing agentSessionId to null (legacy v0.0.16 records)', async () => {
    const s = new Storage(root);
    const id = 'legacy0000';
    // Hand-write a record that predates the agentSessionId field.
    await mkdir(join(root, '.pinagent', 'feedback'), { recursive: true });
    const legacy = {
      id,
      comment: 'old',
      file: null,
      line: null,
      col: null,
      selector: '',
      url: '',
      viewport: { w: 0, h: 0 },
      userAgent: '',
      screenshot: '',
      status: 'pending',
      note: null,
      commitSha: null,
      createdAt: '2026-01-01',
      resolvedAt: null,
    };
    await writeFile(
      join(root, '.pinagent', 'feedback', `${id}.json`),
      JSON.stringify(legacy),
      'utf8',
    );
    const read = await s.read(id);
    expect(read?.agentSessionId).toBeNull();
  });

  describe('patch', () => {
    it('updates only the provided fields', async () => {
      const s = new Storage(root);
      const id = nanoid(10);
      const created = await s.create(id, makeInput());
      const patched = await s.patch(id, { note: 'agent fixed' });
      expect(patched?.note).toBe('agent fixed');
      expect(patched?.status).toBe(created.status);
      expect(patched?.commitSha).toBeNull();
    });

    it('sets resolvedAt on status change away from pending', async () => {
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());
      const patched = await s.patch(id, { status: 'fixed' });
      expect(patched?.status).toBe('fixed');
      expect(patched?.resolvedAt).toBeTruthy();
      expect(new Date(patched!.resolvedAt!).toString()).not.toBe('Invalid Date');
    });

    it('clears resolvedAt when status returns to pending', async () => {
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());
      await s.patch(id, { status: 'fixed' });
      const patched = await s.patch(id, { status: 'pending' });
      expect(patched?.resolvedAt).toBeNull();
    });

    it('returns null for an unknown id', async () => {
      const s = new Storage(root);
      expect(await s.patch('aBcDeFgHiJ', { note: 'x' })).toBeNull();
    });

    it('persists agentSessionId', async () => {
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());
      await s.patch(id, { agentSessionId: 'sess-abc-123' });
      const read = await s.read(id);
      expect(read?.agentSessionId).toBe('sess-abc-123');
    });
  });

  describe('messageCount + listMessages', () => {
    it('freshly created row reports messageCount: 0', async () => {
      const s = new Storage(root);
      const id = nanoid(10);
      const created = await s.create(id, makeInput());
      expect(created.messageCount).toBe(0);
      const read = await s.read(id);
      expect(read?.messageCount).toBe(0);
    });

    it('list + read reflect published transcript events, excluding init/result/__finished', async () => {
      // Dynamic import so the in-process DB cache for `root` is fresh.
      const bus = await import('../src/bus');
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());

      const b = bus.getOrCreateBus(id, root);
      // init / result are bookkeeping — should NOT count.
      await b.publish({
        type: 'init',
        sessionId: 'sess-x',
        model: 'claude',
        permissionMode: 'acceptEdits',
        apiKeySource: 'oauth',
      });
      await b.publish({ type: 'text', text: 'looking at the button' });
      await b.publish({ type: 'tool_use', name: 'Edit', summary: 'src/Foo.tsx' });
      await b.publish({ type: 'tool_result', ok: true });
      await b.publish({
        type: 'result',
        subtype: 'success',
        numTurns: 1,
        totalCostUsd: 0.01,
        durationMs: 1000,
      });

      const read = await s.read(id);
      expect(read?.messageCount).toBe(3);
      const list = await s.list();
      expect(list.find((r) => r.id === id)?.messageCount).toBe(3);
    });

    it('listMessages returns events in insertion order', async () => {
      const bus = await import('../src/bus');
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());

      const b = bus.getOrCreateBus(id, root);
      await b.publish({ type: 'text', text: 'first' });
      await b.publish({ type: 'text', text: 'second' });
      await b.publish({ type: 'text', text: 'third' });

      const events = await s.listMessages(id);
      expect(events).toHaveLength(3);
      expect(events.map((e) => (e.type === 'text' ? e.text : null))).toEqual([
        'first',
        'second',
        'third',
      ]);
    });

    it('listMessages includes init/result (it is the full transcript) but excludes __finished', async () => {
      // Distinct from messageCount, which excludes init/result/__finished.
      // The transcript endpoint shows the agent's full output stream so
      // consumers can re-render the conversation; bookkeeping events
      // belong in the transcript, the bus sentinel doesn't.
      const bus = await import('../src/bus');
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());

      const b = bus.getOrCreateBus(id, root);
      await b.publish({
        type: 'init',
        sessionId: 'sess-x',
        model: 'claude',
        permissionMode: 'acceptEdits',
        apiKeySource: 'oauth',
      });
      await b.publish({ type: 'text', text: 'hi' });
      await b.markFinished();

      const events = await s.listMessages(id);
      expect(events.map((e) => e.type)).toEqual(['init', 'text']);
    });

    it('listMessages returns [] for an invalid id (no fs hit)', async () => {
      const s = new Storage(root);
      expect(await s.listMessages('!')).toEqual([]);
    });

    it('listMessages returns [] for an unknown but well-formed id', async () => {
      const s = new Storage(root);
      expect(await s.listMessages('aBcDeFgHiJ')).toEqual([]);
    });
  });

  describe('cost aggregation', () => {
    it('freshly created row reports totalCostUsd: 0', async () => {
      const s = new Storage(root);
      const id = nanoid(10);
      const created = await s.create(id, makeInput());
      expect(created.totalCostUsd).toBe(0);
      const read = await s.read(id);
      expect(read?.totalCostUsd).toBe(0);
      const [listed] = await s.list();
      expect(listed?.totalCostUsd).toBe(0);
    });

    it('list + read sum totalCostUsd across every result event', async () => {
      const bus = await import('../src/bus');
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());
      const b = bus.getOrCreateBus(id, root);
      await b.publish({
        type: 'result',
        subtype: 'success',
        numTurns: 1,
        totalCostUsd: 0.05,
        durationMs: 100,
      });
      await b.publish({
        type: 'result',
        subtype: 'success',
        numTurns: 1,
        totalCostUsd: 0.07,
        durationMs: 100,
      });

      expect(await s.computeConversationCost(id)).toBeCloseTo(0.12, 4);
      const read = await s.read(id);
      expect(read?.totalCostUsd).toBeCloseTo(0.12, 4);
      const list = await s.list();
      expect(list.find((r) => r.id === id)?.totalCostUsd).toBeCloseTo(0.12, 4);
    });

    it('ignores text/tool_use/etc events when summing cost', async () => {
      const bus = await import('../src/bus');
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());
      const b = bus.getOrCreateBus(id, root);
      // Non-result events have no totalCostUsd; tolerant of any shape.
      await b.publish({ type: 'text', text: 'hi' });
      await b.publish({ type: 'tool_use', name: 'Edit', summary: 'src/Foo.tsx' });
      expect(await s.computeConversationCost(id)).toBe(0);
    });

    it('tolerates result events without a numeric totalCostUsd (counts 0)', async () => {
      // Defensive: an SDK shape change or a historical row missing the
      // field shouldn't crash the aggregate.
      const bus = await import('../src/bus');
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());
      const b = bus.getOrCreateBus(id, root);
      await b.publish({
        type: 'result',
        subtype: 'success',
        numTurns: 1,
        totalCostUsd: NaN as unknown as number,
        durationMs: 100,
      });
      await b.publish({
        type: 'result',
        subtype: 'success',
        numTurns: 1,
        totalCostUsd: 0.03,
        durationMs: 100,
      });
      expect(await s.computeConversationCost(id)).toBeCloseTo(0.03, 4);
    });

    it('computeMonthlySpend sums result events across conversations in the calendar month', async () => {
      const bus = await import('../src/bus');
      const s = new Storage(root);
      const id1 = nanoid(10);
      const id2 = nanoid(10);
      await s.create(id1, makeInput());
      await s.create(id2, makeInput());
      const b1 = bus.getOrCreateBus(id1, root);
      const b2 = bus.getOrCreateBus(id2, root);
      await b1.publish({
        type: 'result',
        subtype: 'success',
        numTurns: 1,
        totalCostUsd: 0.4,
        durationMs: 100,
      });
      await b2.publish({
        type: 'result',
        subtype: 'success',
        numTurns: 1,
        totalCostUsd: 0.6,
        durationMs: 100,
      });

      // Sum for the month each row was created in (same instant for
      // both → same month) is 1.00. Past months pick up nothing.
      const now = new Date();
      expect(await s.computeMonthlySpend(now)).toBeCloseTo(1.0, 4);
      const farPast = new Date('2024-01-15T12:00:00Z');
      expect(await s.computeMonthlySpend(farPast)).toBe(0);
    });

    it('computeConversationCost returns 0 for unknown / invalid ids', async () => {
      const s = new Storage(root);
      expect(await s.computeConversationCost('!')).toBe(0);
      expect(await s.computeConversationCost('aBcDeFgHiJ')).toBe(0);
    });
  });

  describe('apiKeySource derivation', () => {
    it('freshly created row (no init) reports apiKeySource: null', async () => {
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());
      expect(await s.readApiKeySource(id)).toBeNull();
      const read = await s.read(id);
      expect(read?.apiKeySource).toBeNull();
      const [listed] = await s.list();
      expect(listed?.apiKeySource).toBeNull();
    });

    it('list + read surface apiKeySource from the persisted init event', async () => {
      const bus = await import('../src/bus');
      const s = new Storage(root);
      const id = nanoid(10);
      await s.create(id, makeInput());
      const b = bus.getOrCreateBus(id, root);
      await b.publish({
        type: 'init',
        sessionId: 'sess1234',
        model: 'claude',
        permissionMode: 'default',
        apiKeySource: 'oauth',
      });

      expect(await s.readApiKeySource(id)).toBe('oauth');
      const read = await s.read(id);
      expect(read?.apiKeySource).toBe('oauth');
      const list = await s.list();
      expect(list.find((r) => r.id === id)?.apiKeySource).toBe('oauth');
    });

    it('readApiKeySource returns null for unknown / invalid ids', async () => {
      const s = new Storage(root);
      expect(await s.readApiKeySource('!')).toBeNull();
      expect(await s.readApiKeySource('aBcDeFgHiJ')).toBeNull();
    });
  });
});

describe('isInGitignore', () => {
  it('returns false when there is no .gitignore', async () => {
    expect(await isInGitignore(root)).toBe(false);
  });

  it.each([
    ['.pinagent'],
    ['.pinagent/'],
    ['/.pinagent'],
    ['/.pinagent/'],
  ])('accepts the line %s', async (line) => {
    await writeFile(join(root, '.gitignore'), `node_modules\n${line}\nbuild\n`, 'utf8');
    expect(await isInGitignore(root)).toBe(true);
  });

  it('rejects unrelated lines', async () => {
    await writeFile(join(root, '.gitignore'), 'node_modules\n.next\ndist\n', 'utf8');
    expect(await isInGitignore(root)).toBe(false);
  });

  it('ignores leading/trailing whitespace on each line', async () => {
    await writeFile(join(root, '.gitignore'), '  .pinagent  \n', 'utf8');
    expect(await isInGitignore(root)).toBe(true);
  });
});

describe('isInsideRoot', () => {
  it('returns true for paths inside the root', () => {
    expect(isInsideRoot('/abs/root', '/abs/root/sub/file.txt')).toBe(true);
    expect(isInsideRoot('/abs/root', '/abs/root')).toBe(true);
  });

  it('returns false for parent directories', () => {
    expect(isInsideRoot('/abs/root', '/abs')).toBe(false);
    expect(isInsideRoot('/abs/root', '/abs/other')).toBe(false);
  });

  it('returns false for path traversal escapes', () => {
    expect(isInsideRoot('/abs/root', '/abs/root/../outside')).toBe(false);
  });
});

describe('FeedbackInputSchema.additionalAnchors', () => {
  // Minimal valid payload — the schema requires a screenshot, loc,
  // viewport, etc. so the per-test overrides are tiny.
  function baseInput(extra?: Partial<FeedbackInput>): unknown {
    return {
      comment: 'multi-pick test',
      loc: { file: 'src/Foo.tsx', line: 1, col: 0 },
      selector: 'main',
      url: 'http://localhost:3000/',
      viewport: { w: 1280, h: 720 },
      userAgent: 'test-agent',
      screenshot: 'iVBORw==',
      createdAt: '2026-05-25T12:00:00.000Z',
      ...extra,
    };
  }

  it('accepts a payload with no additionalAnchors key at all (single-pick is the common case)', () => {
    const parsed = FeedbackInputSchema.parse(baseInput());
    expect(parsed.additionalAnchors).toBeUndefined();
  });

  it('accepts an empty array (client elected to send one even though they could omit)', () => {
    const parsed = FeedbackInputSchema.parse(baseInput({ additionalAnchors: [] }));
    expect(parsed.additionalAnchors).toEqual([]);
  });

  it('accepts a well-formed extras array, allowing nulls in file/line/col', () => {
    const extras = [
      { file: 'src/A.tsx', line: 1, col: 0, selector: '.a', clickX: 10, clickY: 20 },
      { file: null, line: null, col: null, selector: '.b', clickX: 30, clickY: 40 },
    ];
    const parsed = FeedbackInputSchema.parse(baseInput({ additionalAnchors: extras }));
    expect(parsed.additionalAnchors).toEqual(extras);
  });

  it('rejects more than 32 extras (runaway client guard)', () => {
    const many = Array.from({ length: 33 }, (_, i) => ({
      file: null,
      line: null,
      col: null,
      selector: `.x-${i}`,
      clickX: i,
      clickY: i,
    }));
    expect(() => FeedbackInputSchema.parse(baseInput({ additionalAnchors: many }))).toThrow();
  });

  it('rejects an extra missing required selector', () => {
    expect(() =>
      FeedbackInputSchema.parse(
        baseInput({
          // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid shape
          additionalAnchors: [{ file: null, line: null, col: null, clickX: 0, clickY: 0 } as any],
        }),
      ),
    ).toThrow();
  });

  it('rejects an extra with non-numeric click coordinates', () => {
    expect(() =>
      FeedbackInputSchema.parse(
        baseInput({
          additionalAnchors: [
            {
              file: null,
              line: null,
              col: null,
              selector: '.b',
              // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid shape
              clickX: 'no' as any,
              clickY: 0,
            },
          ],
        }),
      ),
    ).toThrow();
  });
});
