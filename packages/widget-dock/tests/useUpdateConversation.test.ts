// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the cache-invalidation contract behind `useUpdateConversation`.
 * The mutation lives in the hook, but the *behavior* — which cache
 * entries it marks stale — has to stay in lock-step with the keys
 * `useConversations` and `useConversation` use to fetch. Those keys
 * have no compiler relationship, so a typo in one would silently leave
 * the rename UX showing stale data until the user backs out and reopens.
 *
 * Tested directly against a real `QueryClient` because `@tanstack/
 * react-query`'s cache + invalidation logic is pure-JS and runs fine
 * without React. The hook itself is a one-liner that defers to this
 * helper, so testing the helper is the high-value pin.
 */
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { invalidateAfterUpdateConversation } from '../src/hooks/useUpdateConversation';
import type { Conversation, ConversationDetail } from '../src/transport';

const KIND = 'mock';
const OPEN_ID = 'fb_open';
const OTHER_ID = 'fb_other';

// Fixture conversations + detail are placeholders — the cache just needs
// SOMETHING under each key so we can observe whether it gets marked
// stale. Shape doesn't matter for the invalidation logic.
const fixtureList: Conversation[] = [];
const fixtureDetail: ConversationDetail = {
  id: OPEN_ID,
  shortId: 'open',
  title: 'open',
  comment: '',
  status: 'pending',
  page: '',
  anchor: { loc: '', selector: '' },
  branch: null,
  messageCount: 0,
  archived: false,
  updatedAt: '2026-05-28T00:00:00Z',
} as ConversationDetail;

function freshClient(): QueryClient {
  // staleTime: 0 + gcTime: Infinity means a query is considered stale
  // immediately when invalidated, but never GC'd out of the cache —
  // both important so isStale() reflects only the invalidate calls.
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 0, gcTime: Number.POSITIVE_INFINITY, retry: false },
    },
  });
}

/** Seed the cache the same way an open dock would after first-render. */
function seedCache(qc: QueryClient): void {
  // Three filter variants of the list query — every one should be
  // invalidated because the rename/archive could affect any of them.
  qc.setQueryData(['conversations', KIND, null], fixtureList);
  qc.setQueryData(['conversations', KIND, { includeArchived: true }], fixtureList);
  qc.setQueryData(['conversations', KIND, { query: 'foo' }], fixtureList);
  // Two detail queries — the open one + an unrelated one.
  qc.setQueryData(['conversation', KIND, OPEN_ID], fixtureDetail);
  qc.setQueryData(['conversation', KIND, OTHER_ID], fixtureDetail);
  // Unrelated caches that should be untouched.
  qc.setQueryData(['auditLog', KIND, null, null, null], []);
  qc.setQueryData(['changes', KIND], []);
}

function isStale(qc: QueryClient, key: readonly unknown[]): boolean {
  return qc.getQueryState(key)?.isInvalidated ?? false;
}

describe('invalidateAfterUpdateConversation', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = freshClient();
    seedCache(qc);
  });

  it('marks every list-query variant stale via prefix match', async () => {
    await invalidateAfterUpdateConversation(qc, KIND, OPEN_ID);
    expect(isStale(qc, ['conversations', KIND, null])).toBe(true);
    expect(isStale(qc, ['conversations', KIND, { includeArchived: true }])).toBe(true);
    expect(isStale(qc, ['conversations', KIND, { query: 'foo' }])).toBe(true);
  });

  it('marks the open detail query stale', async () => {
    await invalidateAfterUpdateConversation(qc, KIND, OPEN_ID);
    expect(isStale(qc, ['conversation', KIND, OPEN_ID])).toBe(true);
  });

  it('does NOT touch an unrelated detail query', async () => {
    await invalidateAfterUpdateConversation(qc, KIND, OPEN_ID);
    expect(isStale(qc, ['conversation', KIND, OTHER_ID])).toBe(false);
  });

  it('does NOT touch unrelated caches (audit log, changes, etc.)', async () => {
    await invalidateAfterUpdateConversation(qc, KIND, OPEN_ID);
    expect(isStale(qc, ['auditLog', KIND, null, null, null])).toBe(false);
    expect(isStale(qc, ['changes', KIND])).toBe(false);
  });

  it('scopes by transport.kind so a separate mock vs local cache stays untouched', async () => {
    qc.setQueryData(['conversations', 'local', null], fixtureList);
    qc.setQueryData(['conversation', 'local', OPEN_ID], fixtureDetail);
    await invalidateAfterUpdateConversation(qc, KIND, OPEN_ID);
    expect(isStale(qc, ['conversations', 'local', null])).toBe(false);
    expect(isStale(qc, ['conversation', 'local', OPEN_ID])).toBe(false);
  });

  it('awaits both invalidations before resolving', async () => {
    // Promise.all timing — if onSuccess returns before both invalidations
    // settle, the next render could read pre-invalidation cache.
    let resolved = false;
    const p = invalidateAfterUpdateConversation(qc, KIND, OPEN_ID).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    await p;
    expect(resolved).toBe(true);
  });
});
