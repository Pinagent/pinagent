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
  /** True after the server signals the agent run finished. */
  done: boolean;
}

const EMPTY_STREAM: ConversationStream = { items: [], worktree: null, done: false };

export function useConversationStream(id: string | null): ConversationStream {
  const transport = useTransport();
  const [stream, setStream] = useState<ConversationStream>(EMPTY_STREAM);
  // Monotonic counter for stable React keys on each pushed item. Held
  // in a ref so it survives re-renders without re-triggering effects.
  const nextIdRef = useRef(0);

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
      onDone() {
        setStream((prev) => ({ ...prev, done: true }));
      },
    };
    return transport.subscribeConversation(id, handlers);
  }, [id, transport]);

  return stream;
}
