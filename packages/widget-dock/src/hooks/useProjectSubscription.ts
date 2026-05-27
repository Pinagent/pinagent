// SPDX-License-Identifier: Apache-2.0
/**
 * Open a persistent WebSocket to the pinagent dev-server, subscribe to
 * the project channel, and invalidate the TanStack Query cache when
 * `conversations_changed` events arrive. Result: the dock's lists
 * refresh in realtime as conversations are created, updated, landed,
 * or discarded by anyone holding a widget on any page.
 *
 * Reconnect with exponential backoff so transient dev-server restarts
 * (HMR, port changes) don't drop the live link permanently.
 *
 * Returns a small status object so the chrome can render "Live" vs
 * "Reconnecting" indicators without owning the socket itself.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { resolveWsUrl } from '../lib/ws-url';

export type SubscriptionStatus = 'idle' | 'connecting' | 'open' | 'closed';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export interface UseProjectSubscriptionOptions {
  /** When false (e.g. mock-transport mode), the hook is a no-op. */
  enabled?: boolean;
}

export function useProjectSubscription({ enabled = true }: UseProjectSubscriptionOptions = {}): {
  status: SubscriptionStatus;
  url: string | null;
} {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SubscriptionStatus>('idle');
  const url = enabled ? resolveWsUrl() : null;
  // Held in a ref so the effect's cleanup can close the live socket
  // without re-running every time React's strict-mode double-effect
  // fires. Reconnect state likewise survives across mounts.
  const stateRef = useRef<{
    socket: WebSocket | null;
    closedByUs: boolean;
    backoffMs: number;
    retryTimer: ReturnType<typeof setTimeout> | null;
  }>({ socket: null, closedByUs: false, backoffMs: RECONNECT_MIN_MS, retryTimer: null });

  useEffect(() => {
    if (!url) {
      setStatus('idle');
      return;
    }

    const state = stateRef.current;
    state.closedByUs = false;

    const connect = (): void => {
      setStatus('connecting');
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        // URL syntactically invalid; retry won't help, but keep the
        // hook in 'closed' so the UI can show the indicator.
        setStatus('closed');
        return;
      }
      state.socket = socket;

      socket.addEventListener('open', () => {
        state.backoffMs = RECONNECT_MIN_MS;
        setStatus('open');
        try {
          socket.send(JSON.stringify({ type: 'subscribe_project' }));
        } catch {
          // Will get caught by the close handler and trigger reconnect.
        }
      });

      socket.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (
            msg &&
            typeof msg === 'object' &&
            msg.type === 'project_event' &&
            msg.event?.type === 'conversations_changed'
          ) {
            // Trigger refetch for every active conversations query
            // regardless of filter parameters. The cache key includes
            // transport.kind + filters; invalidating by prefix catches
            // them all.
            void queryClient.invalidateQueries({ queryKey: ['conversations'] });
          }
        } catch {
          // Non-JSON or unexpected shape — ignore silently.
        }
      });

      const scheduleReconnect = (): void => {
        if (state.closedByUs) return;
        const delay = state.backoffMs;
        state.backoffMs = Math.min(state.backoffMs * 2, RECONNECT_MAX_MS);
        state.retryTimer = setTimeout(connect, delay);
      };

      socket.addEventListener('close', () => {
        state.socket = null;
        setStatus('closed');
        scheduleReconnect();
      });

      socket.addEventListener('error', () => {
        // The 'close' event will fire right after; let it handle the
        // reconnect bookkeeping.
      });
    };

    connect();

    return () => {
      state.closedByUs = true;
      if (state.retryTimer) {
        clearTimeout(state.retryTimer);
        state.retryTimer = null;
      }
      if (state.socket) {
        try {
          state.socket.send(JSON.stringify({ type: 'unsubscribe_project' }));
        } catch {
          // Socket may already be closing; close() below handles it.
        }
        state.socket.close();
        state.socket = null;
      }
      state.backoffMs = RECONNECT_MIN_MS;
    };
  }, [url, queryClient]);

  return { status, url };
}
