// SPDX-License-Identifier: Apache-2.0
/**
 * Project-wide event pub/sub. Storage publishes after every write that
 * could change a conversation row (`create`, `patchWithDiff`); ws-server
 * subscribes once at startup and fans out to every socket that sent
 * `subscribe_project`.
 *
 * Lives in this package (not @pinagent/shared) because only the server
 * runtime emits or subscribes. The wire type (`ProjectEvent`) is shared.
 *
 * Pinned via globalThis so Next 16's route re-evaluation doesn't reset
 * the listener set between HMR cycles — same pattern as the
 * `worktreeSubs` map in ws-server.
 */
import type { ProjectEvent } from '@pinagent/shared';

type Listener = (event: ProjectEvent) => void;

const LISTENERS_SYMBOL = Symbol.for('pinagent.project-event.listeners');

const listeners: Set<Listener> =
  ((globalThis as Record<symbol, unknown>)[LISTENERS_SYMBOL] as Set<Listener> | undefined) ??
  new Set<Listener>();
(globalThis as Record<symbol, unknown>)[LISTENERS_SYMBOL] = listeners;

export function emitProjectChange(event: ProjectEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Listener errors must not propagate to the writer that triggered
      // the emit — keeps storage callsites simple.
    }
  }
}

export function onProjectChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
