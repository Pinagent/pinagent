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
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { type ConnectionStatus, useTransport } from '../transport';

export interface UseProjectSubscriptionOptions {
  /** When false (e.g. mock-transport mode), the hook is a no-op. */
  enabled?: boolean;
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
    const unsubEvents = transport.subscribeProject((event) => {
      if (event.type === 'conversations_changed') {
        // Any conversation change can affect both the list view AND
        // the Changes view (worktree-state transitions ripple into
        // diff stats). Invalidate both query namespaces.
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        void queryClient.invalidateQueries({ queryKey: ['changes'] });
        void queryClient.invalidateQueries({ queryKey: ['branches'] });
      }
    });
    const unsubStatus = transport.onConnectionStatus(setStatus);
    return () => {
      unsubEvents();
      unsubStatus();
    };
  }, [enabled, transport, queryClient]);

  return { status };
}
