// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the WS-vs-prefetched merge invariant in `useConversationStream`:
 * the moment the WS subscriber has delivered any item, those become
 * authoritative; until then we render whatever the HTTP transcript
 * prefetch returned.
 *
 * Why this contract matters: the SqliteEventBus replays the full
 * transcript on first poll, so any prefetched events are about to be
 * re-delivered. Switching the display source on first WS item avoids
 * needing to dedupe by content.
 */
import { describe, expect, it } from 'vitest';
import {
  type ConversationStream,
  mergeStreamView,
  type StreamItem,
} from '../src/hooks/useConversationStream';

const wsItem = (id: number, text: string): StreamItem => ({
  kind: 'event',
  id,
  event: { type: 'text', text },
  receivedAt: '2026-05-28T00:00:00.000Z',
});

const prefetchedItem = (id: number, text: string): StreamItem => ({
  kind: 'event',
  // Negative ids in production; doesn't matter for the merge logic but
  // mirrors the real call site.
  id: -id,
  event: { type: 'text', text },
  receivedAt: '2026-05-28T00:00:00.000Z',
});

const wsStream = (
  items: StreamItem[],
  worktree: ConversationStream['worktree'] = null,
): ConversationStream => ({ items, worktree });

describe('mergeStreamView', () => {
  it('returns the prefetched items when the WS stream is empty', () => {
    const merged = mergeStreamView(wsStream([]), [
      prefetchedItem(1, 'hi'),
      prefetchedItem(2, 'ho'),
    ]);
    expect(merged.items.map((i) => (i.kind === 'event' ? i.id : null))).toEqual([-1, -2]);
  });

  it('switches to WS items the moment any arrive (one is enough)', () => {
    const merged = mergeStreamView(wsStream([wsItem(1, 'live')]), [
      prefetchedItem(1, 'cached-1'),
      prefetchedItem(2, 'cached-2'),
    ]);
    expect(merged.items).toEqual([wsItem(1, 'live')]);
  });

  it('returns an empty list when both sources are empty', () => {
    const merged = mergeStreamView(wsStream([]), []);
    expect(merged.items).toEqual([]);
  });

  it('always passes worktree state through from the WS stream', () => {
    const worktree = { feedbackId: 'cv_01', state: 'active' as const };
    const fromWs = mergeStreamView(wsStream([wsItem(1, 'a')], worktree), []);
    expect(fromWs.worktree).toEqual(worktree);

    // Even when the WS items are empty and we render prefetched, the
    // worktree state still comes from the WS stream — the HTTP
    // prefetch knows nothing about worktree lifecycle.
    const fromPrefetched = mergeStreamView(wsStream([], worktree), [prefetchedItem(1, 'a')]);
    expect(fromPrefetched.worktree).toEqual(worktree);
  });

  it('never mixes prefetched and WS items (no dedupe required)', () => {
    // Regression for the "the bus replays so prefetched would
    // duplicate" failure mode. As soon as ANY WS item is present, the
    // prefetched array drops out entirely.
    const merged = mergeStreamView(wsStream([wsItem(1, 'replay-1')]), [
      prefetchedItem(1, 'cached-1'),
    ]);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toBe(merged.items[0]);
    expect(merged.items.some((i) => i.kind === 'event' && i.id < 0)).toBe(false);
  });
});
