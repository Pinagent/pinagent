// SPDX-License-Identifier: Apache-2.0
import type { QueuedFollowUp } from './types';

/**
 * localStorage outbox for the client-side follow-up queue (ticket 004).
 *
 * Follow-ups typed (or elements picked) while an agent turn is in flight are
 * held client-side and flushed one-per-turn-end, FIFO. The queue lives on the
 * in-memory `composer` so it survives WS *reconnects*, but a full page
 * *reload* dropped it — the one piece of conversation state the server can't
 * rebuild, since it's client-originated and unsent.
 *
 * This persists the queue per-conversation so it survives reload. Deliberately
 * NOT the SQLite mirror: that mirror is documented as a *rebuildable* projection
 * of server state (wipe + rehydrate on divergence), and unsent client data
 * doesn't belong in it. localStorage is per-origin and the widget is
 * localhost-only; keying by the nanoid feedbackId makes any cross-app collision
 * on the same port harmless.
 *
 * Persisted shape is the live {@link QueuedFollowUp} (`content` + optional
 * `node` anchor payload) — we persist the anchor data, never a DOM node.
 */

const KEY_PREFIX = 'pinagent:followups:';

function keyFor(feedbackId: string): string {
  return `${KEY_PREFIX}${feedbackId}`;
}

/** Minimal localStorage surface, so the helpers are unit-testable with a fake. */
export type OutboxStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Read the persisted queue for a conversation. Returns `[]` for a missing key,
 * malformed JSON, or a non-array payload (forward/backward tolerant).
 */
export function loadFollowUpQueue(storage: OutboxStorage, feedbackId: string): QueuedFollowUp[] {
  let raw: string | null;
  try {
    raw = storage.getItem(keyFor(feedbackId));
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed entries — content is required; node is optional
    // and passed through as-is (it's a plain anchor payload).
    return parsed
      .filter(
        (item): item is QueuedFollowUp =>
          !!item && typeof item === 'object' && typeof item.content === 'string',
      )
      .map((item) =>
        item.node ? { content: item.content, node: item.node } : { content: item.content },
      );
  } catch {
    return [];
  }
}

/**
 * Write-through the current queue. An empty queue removes the key entirely so
 * a fully-flushed conversation leaves no stale entry behind.
 */
export function saveFollowUpQueue(
  storage: OutboxStorage,
  feedbackId: string,
  queue: readonly QueuedFollowUp[],
): void {
  try {
    if (queue.length === 0) {
      storage.removeItem(keyFor(feedbackId));
      return;
    }
    storage.setItem(keyFor(feedbackId), JSON.stringify(queue));
  } catch {
    // Storage unavailable / quota — best-effort; the in-memory queue still
    // drives this session, only reload-survival is lost.
  }
}

/** Drop a conversation's persisted queue (dismiss / delete / terminal resolve). */
export function clearFollowUpQueue(storage: OutboxStorage, feedbackId: string): void {
  try {
    storage.removeItem(keyFor(feedbackId));
  } catch {
    // Best-effort.
  }
}
