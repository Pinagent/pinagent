// SPDX-License-Identifier: Apache-2.0
import { WebSocket } from 'ws';

// The dev-server's WebSocket bridge. Hardcoded to the default port: the
// browser widget learns the actual (possibly port-walked) port from an
// injected config prelude, but the extension has no such channel, so we
// connect to the convention. If the server fell back to 53637+ because
// 53636 was taken, presence simply won't register — a documented POC
// limitation, not a correctness bug (the URI-handler half still works).
const WS_URL = 'ws://127.0.0.1:53636/__pinagent/ws';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Keeps a best-effort WebSocket open to the pinagent dev-server and
 * announces this extension's presence with an `extension_hello`. The
 * dock listens for the resulting `extension_status` broadcast to decide
 * whether to nudge the developer to install the extension — so the whole
 * job of this client is "be connected and say hello", nothing more.
 *
 * There may be no server listening (the developer hasn't started their
 * app, or it's a non-pinagent project). That's expected: we retry with
 * capped exponential backoff and stay quiet about failures.
 */
export class PresenceClient {
  private socket: WebSocket | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly version: string) {}

  start(): void {
    this.disposed = false;
    this.connect();
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      // Closing cleanly fires the server's `close` handler, which drops
      // our presence and re-broadcasts "not installed" to the docks.
      try {
        this.socket.close();
      } catch {
        // Half-open socket; nothing to do.
      }
      this.socket = null;
    }
  }

  private connect(): void {
    if (this.disposed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(WS_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.on('open', () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      try {
        socket.send(JSON.stringify({ type: 'extension_hello', version: this.version }));
      } catch {
        // Will retry on the next reconnect.
      }
    });

    // The server speaks to project subscribers, not to us; we don't need
    // to read anything. Draining 'message' avoids backpressure warnings.
    socket.on('message', () => {});

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.scheduleReconnect();
    });

    socket.on('error', () => {
      // 'close' follows and drives the reconnect; swallow so an
      // unhandled 'error' doesn't crash the extension host.
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
