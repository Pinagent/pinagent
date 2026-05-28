// SPDX-License-Identifier: Apache-2.0
/**
 * MockTransport mutation round-trip — guards `?fixtures=on` mode, the
 * surface every design review and demo runs on. The mock keeps a
 * mutable per-instance conversations array; this test pins the
 * mutate → re-read contract so a refactor can't silently break the
 * fixture loop (rename/archive disappear on next list, archived
 * filter doesn't apply, etc.) without us noticing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MockTransport } from '../src/transport/mock';

describe('MockTransport.updateConversation round-trip', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = new MockTransport();
  });

  it('returns a conversation with the new title', async () => {
    const [first] = await transport.listConversations();
    expect(first).toBeDefined();
    const updated = await transport.updateConversation(first!.id, { title: 'New title' });
    expect(updated.title).toBe('New title');
    expect(updated.id).toBe(first!.id);
  });

  it('next listConversations reflects the rename', async () => {
    const [first] = await transport.listConversations();
    await transport.updateConversation(first!.id, { title: 'Persisted' });
    const after = await transport.listConversations();
    const found = after.find((c) => c.id === first!.id);
    expect(found?.title).toBe('Persisted');
  });

  it('archiving filters the row out of the default list', async () => {
    const list = await transport.listConversations();
    const target = list.find((c) => !c.archived);
    expect(target).toBeDefined();
    await transport.updateConversation(target!.id, { archived: true });
    const visible = await transport.listConversations();
    expect(visible.find((c) => c.id === target!.id)).toBeUndefined();
  });

  it('archived row returns when includeArchived is set', async () => {
    const list = await transport.listConversations();
    const target = list.find((c) => !c.archived);
    await transport.updateConversation(target!.id, { archived: true });
    const visible = await transport.listConversations({ includeArchived: true });
    const found = visible.find((c) => c.id === target!.id);
    expect(found?.archived).toBe(true);
  });

  it('empty-string title collapses to keep the prior title (does not clear)', async () => {
    // The mock can't recover the comment-derived title (real server can
    // by reading the underlying comment); it falls back to the current
    // title instead. Pin that behavior so design-review of the rename
    // UX doesn't show an unexpected blank.
    const [first] = await transport.listConversations();
    const before = first!.title;
    const updated = await transport.updateConversation(first!.id, { title: '' });
    expect(updated.title).toBe(before);
  });

  it('bulkArchive returns updated + skipped sets and applies to the list', async () => {
    const list = await transport.listConversations();
    const live = list.filter((c) => !c.archived).slice(0, 2);
    expect(live.length).toBe(2);
    const ids = live.map((c) => c.id);
    const result = await transport.bulkArchive(ids, true);
    expect(result.updated.sort()).toEqual(ids.slice().sort());
    expect(result.skipped).toEqual([]);

    const visible = await transport.listConversations();
    for (const id of ids) {
      expect(visible.find((c) => c.id === id)).toBeUndefined();
    }

    // Re-running with the same ids should now skip them (no work to do).
    const second = await transport.bulkArchive(ids, true);
    expect(second.updated).toEqual([]);
    expect(second.skipped.sort()).toEqual(ids.slice().sort());
  });
});
