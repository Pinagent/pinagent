// SPDX-License-Identifier: Apache-2.0
/**
 * Follow-up send queue for the conversation detail view — mirrors the
 * per-element widget's `followUpQueue`.
 *
 * The dev server rejects a `user_message` that arrives while a turn is still in
 * flight ("a turn is already in progress"). Without queueing, a reply typed
 * during (or right as) a running turn is dropped server-side while its
 * optimistic bubble lingers as if delivered. This queue parks such replies and
 * flushes them one-per-turn-end, and re-queues a send the server bounced.
 *
 * Pure + React-free so the decision logic is unit-testable; the component wires
 * it to the transport and the stream's `turnRunning` signal.
 */
export interface FollowupQueue {
  /**
   * Decide whether to send `content` immediately. Returns `true` when the turn
   * is idle (send now); parks it and returns `false` when a turn is running.
   */
  submit(content: string, turnRunning: boolean): boolean;
  /** The next parked message to send at turn-end, or `null` when empty. */
  nextOnTurnEnd(): string | null;
  /** A send the server bounced — re-park it at the FRONT to retry first. */
  requeue(content: string): void;
  readonly size: number;
}

export function createFollowupQueue(): FollowupQueue {
  const queue: string[] = [];
  return {
    submit(content, turnRunning) {
      if (turnRunning) {
        queue.push(content);
        return false;
      }
      return true;
    },
    nextOnTurnEnd() {
      return queue.shift() ?? null;
    },
    requeue(content) {
      queue.unshift(content);
    },
    get size() {
      return queue.length;
    },
  };
}

/** Whether a stream error is the server's "turn already in progress" bounce. */
export function isTurnBusyError(message: string): boolean {
  return /turn (is )?already in progress/i.test(message);
}
