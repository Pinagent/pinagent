// SPDX-License-Identifier: Apache-2.0
/**
 * Subscribe to the dev-server's project channel and invalidate the
 * TanStack Query cache when `conversations_changed` events arrive.
 * Result: the dock's lists refresh in realtime as conversations are
 * created, updated, landed, or discarded.
 *
 * The actual socket lives in the transport (`DockWsClient`) so the
 * project + per-conversation subscriptions share one underlying
 * connection.
 *
 * Returns the live connection status so the chrome can render
 * "Disconnected" without owning the socket itself.
 */
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import type { ProjectEvent } from '@pinagent/shared';
import { useEffect, useState } from 'react';
import { type ConnectionStatus, useTransport } from '../transport';

export interface UseProjectSubscriptionOptions {
  /** When false (e.g. mock-transport mode), the hook is a no-op. */
  enabled?: boolean;
}

/**
 * Query keys touched by a `conversations_changed` event. Any conversation
 * change can affect:
 *
 *   - `conversations`  — the list view
 *   - `conversation`   — the open detail view; without this the status
 *                        timeline pills stay stuck on the initial status
 *                        through the agent's working → landed transitions
 *   - `changes`        — worktree-state transitions ripple into diff stats
 *   - `branches`       — same; the Branches view keys off worktree state
 *   - `pullRequests`   — compose flow flips conversations to landed and
 *                        writes the PR row in the same transition
 *   - `auditLog`       — every lifecycle write also writes an audit row
 */
const CONVERSATIONS_CHANGED_KEYS: readonly (readonly string[])[] = [
  ['conversations'],
  ['conversation'],
  ['changes'],
  ['branches'],
  ['pullRequests'],
  ['auditLog'],
];

/**
 * Factory for the project-event listener. Exposed for unit testing so
 * tests can drive synthetic events without rendering React or spinning
 * up a real transport.
 */
export function createProjectEventListener(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
): (event: ProjectEvent) => void {
  return (event) => {
    if (event.type === 'conversations_changed') {
      for (const queryKey of CONVERSATIONS_CHANGED_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }
  };
}

export function useProjectSubscription({ enabled = true }: UseProjectSubscriptionOptions = {}): {
  status: ConnectionStatus;
} {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>('idle');

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }
    const unsubEvents = transport.subscribeProject(createProjectEventListener(queryClient));
    const unsubStatus = transport.onConnectionStatus(setStatus);
    return () => {
      unsubEvents();
      unsubStatus();
    };
  }, [enabled, transport, queryClient]);

  return { status };
}
