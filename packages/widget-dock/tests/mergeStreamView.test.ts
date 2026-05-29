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
  deriveLiveTurn,
  deriveTurnRunning,
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
): ConversationStream => ({ items, worktree, turnRunning: false, liveTurn: 0 });

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

// Constructors for the AgentEvent variants `deriveTurnRunning` cares
// about. Only the `type` discriminator matters for the toggle logic;
// the rest of the payload is filled in with minimum-viable values.
const initItem = (id: number): StreamItem => ({
  kind: 'event',
  id,
  event: {
    type: 'init',
    sessionId: 's',
    model: 'm',
    permissionMode: 'auto',
    apiKeySource: 'k',
  },
  receivedAt: '2026-05-28T00:00:00.000Z',
});

const resultItem = (id: number): StreamItem => ({
  kind: 'event',
  id,
  event: { type: 'result', subtype: 'success', numTurns: 1, totalCostUsd: 0, durationMs: 100 },
  receivedAt: '2026-05-28T00:00:00.000Z',
});

const errorEventItem = (id: number): StreamItem => ({
  kind: 'event',
  id,
  event: { type: 'error', message: 'boom' },
  receivedAt: '2026-05-28T00:00:00.000Z',
});

const serverErrorItem = (id: number): StreamItem => ({
  kind: 'error',
  id,
  message: 'transport error',
  receivedAt: '2026-05-28T00:00:00.000Z',
});

const askItem = (id: number, askId: string): StreamItem => ({
  kind: 'event',
  id,
  event: { type: 'ask_user', askId, question: 'q?' },
  receivedAt: '2026-05-28T00:00:00.000Z',
});

const progressItem = (id: number, turn: number): StreamItem => ({
  kind: 'event',
  id,
  event: { type: 'progress', turn },
  receivedAt: '2026-05-28T00:00:00.000Z',
});

describe('deriveTurnRunning', () => {
  it('is false for an empty stream', () => {
    expect(deriveTurnRunning([])).toBe(false);
  });

  it('is true after init with no terminal event yet', () => {
    expect(deriveTurnRunning([initItem(1), wsItem(2, 'thinking')])).toBe(true);
  });

  it('flips back to false when result arrives', () => {
    expect(deriveTurnRunning([initItem(1), wsItem(2, 'thinking'), resultItem(3)])).toBe(false);
  });

  it('flips back to false on an AgentEvent error', () => {
    expect(deriveTurnRunning([initItem(1), errorEventItem(2)])).toBe(false);
  });

  it('flips back to false on a server-level (stream-kind) error', () => {
    expect(deriveTurnRunning([initItem(1), serverErrorItem(2)])).toBe(false);
  });

  it('stays true while paused on ask_user (a legitimate stop target)', () => {
    expect(deriveTurnRunning([initItem(1), askItem(2, 'a')])).toBe(true);
  });

  it('tracks multi-turn lifecycles (true → false → true after a fresh init)', () => {
    expect(
      deriveTurnRunning([
        initItem(1),
        resultItem(2),
        // User sent a follow-up; agent emits a fresh init.
        initItem(3),
        wsItem(4, 'thinking again'),
      ]),
    ).toBe(true);
  });
});

describe('mergeStreamView — turnRunning passthrough', () => {
  it('reflects an in-flight turn from the WS items', () => {
    const merged = mergeStreamView(wsStream([initItem(1)]), []);
    expect(merged.turnRunning).toBe(true);
  });

  it('reflects an in-flight turn from the prefetched-only path', () => {
    // Cold-load scenario: HTTP returned events with no WS items yet.
    // turnRunning should be honest about what those events say.
    const merged = mergeStreamView(wsStream([]), [initItem(-1)]);
    expect(merged.turnRunning).toBe(true);
  });
});

describe('deriveLiveTurn', () => {
  it('is 0 for an empty stream', () => {
    expect(deriveLiveTurn([])).toBe(0);
  });

  it('tracks the latest progress turn within a run', () => {
    expect(
      deriveLiveTurn([initItem(1), progressItem(2, 1), wsItem(3, 'thinking'), progressItem(4, 2)]),
    ).toBe(2);
  });

  it('resets to 0 on a fresh init (follow-up turn)', () => {
    expect(deriveLiveTurn([initItem(1), progressItem(2, 3), resultItem(3), initItem(4)])).toBe(0);
  });

  it('passes through mergeStreamView from either source', () => {
    expect(mergeStreamView(wsStream([initItem(1), progressItem(2, 2)]), []).liveTurn).toBe(2);
    expect(mergeStreamView(wsStream([]), [initItem(-1), progressItem(-2, 1)]).liveTurn).toBe(1);
  });
});
