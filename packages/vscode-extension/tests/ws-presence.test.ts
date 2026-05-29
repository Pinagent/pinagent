// SPDX-License-Identifier: Apache-2.0
/**
 * Presence client behavior with a faked `ws` socket: it says
 * `extension_hello` on open, retries with capped exponential backoff on
 * close, stops retrying after dispose, and fans out across the whole
 * port-fallback range. The dock's "extension installed?" detection rides
 * on this, so the hello + reconnect loop are the load-bearing paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factory below can reference it.
const ws = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    handlers: Record<string, Handler[]> = {};
    sent: string[] = [];
    closed = false;
    constructor(public url: string) {
      FakeWebSocket.instances.push(this);
    }
    on(event: string, cb: Handler): this {
      if (!this.handlers[event]) this.handlers[event] = [];
      this.handlers[event]!.push(cb);
      return this;
    }
    fire(event: string, ...args: unknown[]): void {
      for (const h of this.handlers[event] ?? []) h(...args);
    }
    send(data: string): void {
      this.sent.push(data);
    }
    close(): void {
      this.closed = true;
    }
  }
  return { FakeWebSocket };
});

vi.mock('ws', () => ({ WebSocket: ws.FakeWebSocket }));

import { PortPresence, PresenceClient } from '../src/ws-presence';

beforeEach(() => {
  ws.FakeWebSocket.instances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const latest = () => ws.FakeWebSocket.instances[ws.FakeWebSocket.instances.length - 1]!;

describe('PortPresence', () => {
  it('opens a socket and announces extension_hello on open', () => {
    const p = new PortPresence('ws://127.0.0.1:53636/__pinagent/ws', '1.2.3');
    p.start();
    expect(ws.FakeWebSocket.instances).toHaveLength(1);
    latest().fire('open');
    expect(JSON.parse(latest().sent[0]!)).toEqual({ type: 'extension_hello', version: '1.2.3' });
  });

  it('reconnects with capped exponential backoff after close', () => {
    const p = new PortPresence('ws://127.0.0.1:53636/__pinagent/ws', '1.0.0');
    p.start();
    // First close -> reconnect after 1s.
    latest().fire('close');
    expect(ws.FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(ws.FakeWebSocket.instances).toHaveLength(2);

    // Second close -> backoff doubled to 2s (1s isn't enough).
    latest().fire('close');
    vi.advanceTimersByTime(1_000);
    expect(ws.FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    expect(ws.FakeWebSocket.instances).toHaveLength(3);
  });

  it('resets the backoff to 1s after a successful open', () => {
    const p = new PortPresence('ws://127.0.0.1:53636/__pinagent/ws', '1.0.0');
    p.start();
    latest().fire('close');
    vi.advanceTimersByTime(1_000); // reconnect #2
    latest().fire('open'); // success resets delay
    latest().fire('close');
    vi.advanceTimersByTime(1_000); // 1s is enough again
    expect(ws.FakeWebSocket.instances).toHaveLength(3);
  });

  it('does not reconnect after dispose and closes the live socket', () => {
    const p = new PortPresence('ws://127.0.0.1:53636/__pinagent/ws', '1.0.0');
    p.start();
    const sock = latest();
    p.dispose();
    expect(sock.closed).toBe(true);
    // A close event after dispose must not schedule a reconnect.
    sock.fire('close');
    vi.advanceTimersByTime(60_000);
    expect(ws.FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('PresenceClient', () => {
  it('opens one connection per port across the fallback range', () => {
    const client = new PresenceClient('9.9.9');
    client.start();
    expect(ws.FakeWebSocket.instances).toHaveLength(10);
    const urls = ws.FakeWebSocket.instances.map((i) => i.url);
    expect(urls[0]).toBe('ws://127.0.0.1:53636/__pinagent/ws');
    expect(urls[9]).toBe('ws://127.0.0.1:53645/__pinagent/ws');
  });

  it('closes every socket on dispose', () => {
    const client = new PresenceClient('9.9.9');
    client.start();
    client.dispose();
    expect(ws.FakeWebSocket.instances.every((i) => i.closed)).toBe(true);
  });
});
