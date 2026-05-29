// SPDX-License-Identifier: Apache-2.0
import { WebSocket } from 'ws';

// The dev-server's WebSocket bridge. The browser widget learns the actual
// (possibly port-walked) port from an injected config prelude, but the
// extension has no such channel — so it announces presence to the whole
// fallback range the server might have bound to. When 53636 is taken by a
// stale dev server from another project, the real server walks to 53637+
// (see PORT_FALLBACK_RANGE in agent-runner's ws-server.ts); without the
// sweep the dock connected to that real server would never hear our
// `extension_hello` and would keep showing "Not installed".
const WS_HOST = '127.0.0.1';
const WS_PATH = '/__pinagent/ws';
const BASE_PORT = 53636;
// Mirror the server's PORT_FALLBACK_RANGE so we cover every port it could
// have walked to. Keep these in sync if the server's range changes.
const PORT_FALLBACK_RANGE = 10;

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * A best-effort presence connection to a single candidate port. Keeps a
 * WebSocket open to the pinagent dev-server and announces this extension's
 * presence with an `extension_hello`. The dock listens for the resulting
 * `extension_status` broadcast to decide whether to nudge the developer to
 * install the extension — so the whole job is "be connected and say hello".
 *
 * Most ports in the swept range will have no listener (the developer hasn't
 * started their app, it's a non-pinagent project, or the server bound a
 * different port). That's expected: we retry with capped exponential
 * backoff and stay quiet about failures.
 */
class PortPresence {
  private socket: WebSocket | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly url: string,
    private readonly version: string,
  ) {}

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
      socket = new WebSocket(this.url);
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

/**
 * Announces this extension's presence to every dev-server that might be
 * listening in the port fallback range. Holding one connection per port is
 * cheap (idle reconnect timers, no traffic) and means the extension shows
 * up as "Installed" regardless of which port the real server walked to, and
 * even when several pinagent projects are running at once.
 */
export class PresenceClient {
  private readonly ports: PortPresence[];

  constructor(version: string) {
    this.ports = [];
    for (let i = 0; i < PORT_FALLBACK_RANGE; i++) {
      const url = `ws://${WS_HOST}:${BASE_PORT + i}${WS_PATH}`;
      this.ports.push(new PortPresence(url, version));
    }
  }

  start(): void {
    for (const port of this.ports) port.start();
  }

  dispose(): void {
    for (const port of this.ports) port.dispose();
  }
}
