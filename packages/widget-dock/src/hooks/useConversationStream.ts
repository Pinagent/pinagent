// SPDX-License-Identifier: Apache-2.0
/**
 * Subscribe to one conversation's live event bus. The dev-server's
 * bus replays the transcript-so-far synchronously when we subscribe,
 * then streams live events as the agent works. We accumulate them in
 * React state so the detail view re-renders without manually wiring
 * each event type.
 *
 * Worktree-state events are tracked separately because they're a
 * conversation-level property (not part of the agent-event stream)
 * and the Land / Discard UI keys off the latest known state.
 *
 * Cold-load: in parallel with the WS subscribe we fire one HTTP
 * `getConversationMessages` request. Its results are surfaced
 * immediately as "prefetched" items so the detail view has content
 * during the WS-connect window (and stays useful if the WS is broken).
 * Once the WS starts delivering events those become authoritative and
 * the prefetched items are hidden — so no duplicates render, and we
 * never have to dedupe by content.
 *
 * On `id` change (user navigated to a different conversation), the
 * previous subscription is cleaned up and state resets.
 */
import type { AgentEvent } from '@pinagent/shared';
import { useEffect, useRef, useState } from 'react';
import { type ConversationHandlers, useTransport, type WorktreeStatePayload } from '../transport';

/**
 * Each stream item carries a monotonic `id` assigned at push time so
 * React keys don't depend on render-time array index. Biome's
 * noArrayIndexKey flags `key={i}` (and anything derived from it) — and
 * for live streams the warning is real: when the bus replays then
 * starts streaming, item ordering relative to the index changes if we
 * ever filter / reorder.
 */
export type StreamItem =
  | { kind: 'event'; id: number; event: AgentEvent; receivedAt: string }
  | { kind: 'error'; id: number; message: string; receivedAt: string };

export interface ConversationStream {
  items: StreamItem[];
  /** Latest worktree-state broadcast, if any. */
  worktree: WorktreeStatePayload | null;
}

const EMPTY_STREAM: ConversationStream = { items: [], worktree: null };

/**
 * Pick which set of items the detail view renders. WS items are
 * authoritative the moment any of them arrive — the bus replays the
 * full transcript on first poll, so any prefetched events are about to
 * be re-delivered. Showing prefetched only while WS is empty avoids
 * the dedupe problem entirely.
 *
 * Worktree state always rides on `wsStream` (the prefetch is a one-shot
 * HTTP read and has nothing to say about the live worktree lifecycle),
 * so the return value spreads `wsStream` and only overrides `items`.
 *
 * Extracted as a pure function so the invariant ("WS wins once any
 * arrive; otherwise prefetched") can be pinned without a hook-test
 * harness.
 */
export function mergeStreamView(
  wsStream: ConversationStream,
  prefetched: StreamItem[],
): ConversationStream {
  return wsStream.items.length > 0 ? wsStream : { ...wsStream, items: prefetched };
}

export function useConversationStream(id: string | null): ConversationStream {
  const transport = useTransport();
  const [stream, setStream] = useState<ConversationStream>(EMPTY_STREAM);
  const [prefetched, setPrefetched] = useState<StreamItem[]>([]);
  // Monotonic counter for stable React keys on each pushed item. Held
  // in a ref so it survives re-renders without re-triggering effects.
  const nextIdRef = useRef(0);

  // HTTP transcript prefetch — one shot per id. Failures are silent;
  // the WS replay is the authoritative source and will fill in on
  // arrival. Aborted on id change via the `cancelled` flag.
  useEffect(() => {
    setPrefetched([]);
    if (!id) return;
    let cancelled = false;
    transport
      .getConversationMessages(id)
      .then((events) => {
        if (cancelled) return;
        const ts = new Date().toISOString();
        setPrefetched(
          events.map((event, idx) => ({
            kind: 'event' as const,
            // Negative ids so they can't collide with the WS counter,
            // and so the React key set is stable across the
            // prefetch→WS swap.
            id: -(idx + 1),
            event,
            receivedAt: ts,
          })),
        );
      })
      .catch(() => {
        // Network / 404 / parse error — leave prefetched empty and let
        // the WS replay populate. Worth a console hook later for
        // observability; intentionally swallowed for now.
      });
    return () => {
      cancelled = true;
    };
  }, [id, transport]);

  useEffect(() => {
    setStream(EMPTY_STREAM);
    nextIdRef.current = 0;
    if (!id) return;
    const handlers: ConversationHandlers = {
      onEvent(event) {
        const itemId = ++nextIdRef.current;
        setStream((prev) => ({
          ...prev,
          items: [
            ...prev.items,
            { kind: 'event', id: itemId, event, receivedAt: new Date().toISOString() },
          ],
        }));
      },
      onWorktreeState(state) {
        setStream((prev) => ({ ...prev, worktree: state }));
      },
      onError(message) {
        const itemId = ++nextIdRef.current;
        setStream((prev) => ({
          ...prev,
          items: [
            ...prev.items,
            { kind: 'error', id: itemId, message, receivedAt: new Date().toISOString() },
          ],
        }));
      },
      // The dev-server's bus never closes today (`finishBus` isn't wired
      // in production — see `agent.ts`'s "intentionally do NOT call
      // finishBus" note), so `onDone` is a no-op. Kept for protocol
      // compatibility: the transport still translates incoming `done`
      // messages into this callback if one is ever sent.
      onDone() {},
    };
    return transport.subscribeConversation(id, handlers);
  }, [id, transport]);

  return mergeStreamView(stream, prefetched);
}
