// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { buildDeviceUrl, nextBackoff, startRelayClient } from '../src/relay-client';

describe('buildDeviceUrl', () => {
  it('appends the device path and session query', () => {
    expect(buildDeviceUrl('wss://relay.pinagent.dev', 'sess123')).toBe(
      'wss://relay.pinagent.dev/__pinagent/device?session=sess123',
    );
  });

  it('strips trailing slashes from the origin', () => {
    expect(buildDeviceUrl('wss://relay.pinagent.dev/', 'sess123')).toBe(
      'wss://relay.pinagent.dev/__pinagent/device?session=sess123',
    );
  });

  it('url-encodes the session id', () => {
    expect(buildDeviceUrl('wss://r.dev', 'a/b c')).toContain('session=a%2Fb%20c');
  });
});

describe('nextBackoff', () => {
  it('grows exponentially up to the cap', () => {
    const min = 1000;
    const max = 30_000;
    // Full-jitter delays land in [exp/2, exp]; assert the upper bound.
    expect(nextBackoff(0, { min, max })).toBeLessThanOrEqual(1000);
    expect(nextBackoff(1, { min, max })).toBeLessThanOrEqual(2000);
    expect(nextBackoff(2, { min, max })).toBeLessThanOrEqual(4000);
    // Far out, exp is capped at max regardless of attempt.
    expect(nextBackoff(20, { min, max })).toBeLessThanOrEqual(30_000);
  });

  it('never returns below half the exponential floor', () => {
    expect(nextBackoff(0, { min: 1000, max: 30_000 })).toBeGreaterThanOrEqual(500);
  });
});

/** Minimal stand-in for a `ws` client socket the reconnect loop drives. */
class FakeWs {
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  closed = false;
  on(event: string, cb: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
    return this;
  }
  emit(event: string): void {
    for (const cb of this.listeners.get(event) ?? []) cb();
  }
  close(): void {
    this.closed = true;
  }
}

function harness() {
  const sockets: FakeWs[] = [];
  const scheduled: Array<() => void> = [];
  const attach = vi.fn();
  const handle = startRelayClient({
    url: 'wss://relay.test',
    token: 'tok',
    sessionId: 'sess',
    connect: () => {
      const ws = new FakeWs();
      sockets.push(ws);
      return ws as unknown as WebSocket;
    },
    attach,
    schedule: (fn) => {
      scheduled.push(fn);
    },
    log: () => {},
  });
  /** Run the most recently scheduled reconnect. */
  const runScheduled = () => scheduled.shift()?.();
  return { sockets, scheduled, attach, handle, runScheduled };
}

describe('startRelayClient reconnect loop', () => {
  it('attaches the connection handler on open', () => {
    const { sockets, attach } = harness();
    expect(sockets).toHaveLength(1);
    sockets[0]?.emit('open');
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith(sockets[0]);
  });

  it('reconnects after a close', () => {
    const { sockets, runScheduled } = harness();
    sockets[0]?.emit('open');
    sockets[0]?.emit('close');
    // A reconnect was scheduled; running it opens a fresh socket.
    runScheduled();
    expect(sockets).toHaveLength(2);
  });

  it('reconnects after a failed connect (error then close)', () => {
    const { sockets, runScheduled } = harness();
    // Never opened — connection refused surfaces as error + close.
    sockets[0]?.emit('error');
    sockets[0]?.emit('close');
    runScheduled();
    expect(sockets).toHaveLength(2);
  });

  it('stops reconnecting once closed', () => {
    const { sockets, scheduled, handle } = harness();
    sockets[0]?.emit('open');
    handle.close();
    expect(sockets[0]?.closed).toBe(true);
    sockets[0]?.emit('close');
    // No reconnect scheduled after an explicit shutdown.
    expect(scheduled).toHaveLength(0);
  });

  it('does not schedule twice for a single error+close', () => {
    const { sockets, scheduled } = harness();
    sockets[0]?.emit('error');
    sockets[0]?.emit('close');
    expect(scheduled).toHaveLength(1);
  });
});
