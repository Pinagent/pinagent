// SPDX-License-Identifier: Elastic-2.0
/**
 * Control-plane → device push client. POSTs a frame to the relay's internal
 * push endpoint (`POST /__pinagent/internal/push?session=<id>`, authenticated
 * with the shared `RELAY_INTERNAL_SECRET`), which forwards it down the named
 * session's connected device socket. Used to propagate a config change (e.g. a
 * branch-routing policy) to live dev sessions without waiting for a reconnect;
 * see `config-service`'s branch-routing PUT.
 *
 * The relay is the same Worker that serves the device dial-out, so we reach it
 * at `relayPublicUrl`. That URL is a `wss://`/`ws://` address (it's what
 * clients open a WebSocket against) — a Worker `fetch` speaks HTTP, so we
 * normalize the scheme to `https`/`http` before calling.
 */

export interface RelayPushClient {
  /**
   * Deliver `frame` to one session's device socket. Resolves `true` only when
   * the relay confirms delivery (200); `false` when no device is connected
   * (404), the endpoint is disabled/unauthorized, or the call throws — callers
   * treat the push as best-effort.
   */
  pushToSession(sessionId: string, frame: unknown): Promise<boolean>;
}

export interface RelayClientOptions {
  /**
   * Relay base URL — the same value handed to clients as the relay WebSocket
   * endpoint (`wss://…`). The scheme is normalized to HTTP(S) for the fetch.
   */
  baseUrl: string;
  /** Shared internal secret, presented as a Bearer token. */
  secret: string;
  /** Injectable fetch for tests; defaults to the global. */
  fetch?: typeof fetch;
}

export function createRelayClient(options: RelayClientOptions): RelayPushClient {
  const base = httpFromWs(options.baseUrl).replace(/\/+$/, '');
  const fetchFn: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    async pushToSession(sessionId: string, frame: unknown): Promise<boolean> {
      const url = `${base}/__pinagent/internal/push?session=${encodeURIComponent(sessionId)}`;
      try {
        const res = await fetchFn(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.secret}`,
          },
          body: JSON.stringify(frame),
        });
        return res.ok;
      } catch {
        // Network error / aborted fetch — best-effort, never throws to the caller.
        return false;
      }
    },
  };
}

/** Map a `ws(s)://` relay URL to the `http(s)://` scheme a Worker `fetch` needs. */
function httpFromWs(url: string): string {
  if (url.startsWith('wss://')) return `https://${url.slice('wss://'.length)}`;
  if (url.startsWith('ws://')) return `http://${url.slice('ws://'.length)}`;
  return url;
}
