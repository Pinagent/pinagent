// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { attachConnection } from './ws-server';

/**
 * Optional cloud dial-out for the agent-runner.
 *
 * Locally the runner only *binds* a WebSocket server and waits for the
 * widget/dock to connect inbound. To be reachable from a hosted dock when
 * the dev machine is behind NAT, the runner also *dials out* to the
 * `@pinagent/ee-relay` Worker as the session's single "device" socket.
 *
 * The relay does all the multi-client demultiplexing (reference-counting
 * subscriptions, fanning server frames back out by feedbackId), so from
 * the runner's side the relay connection is indistinguishable from one
 * local client — we hand the socket straight to `attachConnection` and
 * reuse every existing message handler. The only thing this module adds
 * is connect/auth and reconnect-with-backoff.
 *
 * Cloud mode is purely additive and opt-in: when `PINAGENT_RELAY_URL` is
 * unset, `maybeStartRelayClient` is a no-op and the runner behaves exactly
 * as before.
 */

export interface RelayClientOptions {
  /** Relay origin, e.g. `wss://relay.pinagent.dev`. */
  url: string;
  /** Bearer token presented to the relay (verified by `ee-auth`). */
  token: string;
  /** Stable id namespacing this machine+project's Durable Object. */
  sessionId: string;
  /** Initial reconnect delay (default 1s). */
  minBackoffMs?: number;
  /** Maximum reconnect delay (default 30s). */
  maxBackoffMs?: number;
  /** Test seam — socket factory. Defaults to a real `ws` client. */
  connect?: (url: string, token: string) => WebSocket;
  /** Test seam — connection wiring. Defaults to `attachConnection`. */
  attach?: (socket: WebSocket) => void;
  /** Test seam — reconnect scheduler. Defaults to `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => void;
  log?: (msg: string) => void;
}

export interface RelayClientHandle {
  close(): void;
}

const DEFAULT_MIN_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEVICE_PATH = '/__pinagent/device';

/** Build the relay's device-endpoint URL for a session. */
export function buildDeviceUrl(origin: string, sessionId: string): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}${DEVICE_PATH}?session=${encodeURIComponent(sessionId)}`;
}

/**
 * Full-jitter exponential backoff: a random delay in `[exp/2, exp]` where
 * `exp = min(max, min * 2^attempt)`. Jitter avoids a thundering herd of
 * dev machines all reconnecting in lockstep after a relay blip.
 */
export function nextBackoff(attempt: number, opts: { min: number; max: number }): number {
  const exp = Math.min(opts.max, opts.min * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

function defaultConnect(url: string, token: string): WebSocket {
  return new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
}

/**
 * Open and maintain the outbound device connection, reconnecting with
 * backoff on any drop. Returns a handle whose `close()` stops reconnecting
 * and tears down the current socket.
 */
export function startRelayClient(opts: RelayClientOptions): RelayClientHandle {
  const min = opts.minBackoffMs ?? DEFAULT_MIN_BACKOFF_MS;
  const max = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const connect = opts.connect ?? defaultConnect;
  const attach = opts.attach ?? attachConnection;
  const schedule = opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  const log = opts.log ?? ((msg: string) => console.log(`[pinagent] ${msg}`));

  const deviceUrl = buildDeviceUrl(opts.url, opts.sessionId);
  let stopped = false;
  let attempt = 0;
  let socket: WebSocket | null = null;

  const open = (): void => {
    if (stopped) return;
    const ws = connect(deviceUrl, opts.token);
    socket = ws;

    ws.on('open', () => {
      attempt = 0;
      log(`relay connected (${deviceUrl})`);
      // Hand off to the shared connection handler — the relay socket is
      // just another client from here on.
      attach(ws);
    });

    ws.on('close', () => {
      if (stopped) return;
      const delay = nextBackoff(attempt++, { min, max });
      log(`relay disconnected; reconnecting in ${delay}ms`);
      schedule(open, delay);
    });

    ws.on('error', () => {
      // A 'close' always follows an 'error' for ws clients; reconnect is
      // handled there so we don't schedule twice.
    });
  };

  open();

  return {
    close() {
      stopped = true;
      try {
        socket?.close();
      } catch {
        // Already closed.
      }
    },
  };
}

/**
 * Derive a stable session id from the project root when one isn't supplied
 * via env. Stable across restarts (so a machine reconnects to its own
 * Durable Object) and opaque (doesn't leak the filesystem path).
 */
function defaultSessionId(): string {
  const root = process.env.PINAGENT_PROJECT_ROOT ?? process.cwd();
  return createHash('sha256').update(root).digest('hex').slice(0, 16);
}

const RELAY_CLIENT_SYMBOL = Symbol.for('pinagent.relayClient');

/**
 * Start the dial-out client iff cloud mode is configured. Reads:
 *   - `PINAGENT_RELAY_URL`     (required to enable; e.g. wss://relay.pinagent.dev)
 *   - `PINAGENT_RELAY_TOKEN`   (required; bearer token for the relay)
 *   - `PINAGENT_RELAY_SESSION` (optional; defaults to a hash of the project root)
 *
 * Singleton-guarded via globalThis for the same Next-16 / HMR re-eval
 * reason the ws-server subscriber sets are pinned — a module reload mustn't
 * open a second device connection.
 */
export function maybeStartRelayClient(): RelayClientHandle | null {
  const url = process.env.PINAGENT_RELAY_URL;
  const token = process.env.PINAGENT_RELAY_TOKEN;
  if (!url || !token) return null;

  const g = globalThis as Record<symbol, unknown>;
  const existing = g[RELAY_CLIENT_SYMBOL] as RelayClientHandle | undefined;
  if (existing) return existing;

  const sessionId = process.env.PINAGENT_RELAY_SESSION ?? defaultSessionId();
  const handle = startRelayClient({ url, token, sessionId });
  g[RELAY_CLIENT_SYMBOL] = handle;
  return handle;
}
