// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackHandler } from '../src/types';
import { WidgetWsClient } from '../src/ws-client';

// Ticket 006: the WS-client lifecycle that makes the widget offline-first.
// A scriptable fake WebSocket (injected via the constructor factory seam)
// drives open/close/message deterministically; fake timers advance the
// reconnect backoff without real waits.

interface FakeSocket {
  url: string;
  readyState: number;
  sent: string[];
  listeners: Record<string, ((ev: unknown) => void)[]>;
  open(): void;
  close(): void;
  message(data: unknown): void;
  send: (payload: string) => void;
}

// WebSocket readyState constants come from happy-dom's global.
const { CONNECTING, OPEN, CLOSED } = WebSocket;

function makeFakeSocketFactory() {
  const sockets: FakeSocket[] = [];
  const factory = (url: string): WebSocket => {
    const listeners: FakeSocket['listeners'] = {};
    const sock: FakeSocket = {
      url,
      readyState: CONNECTING,
      sent: [],
      listeners,
      send(payload: string) {
        this.sent.push(payload);
      },
      open() {
        this.readyState = OPEN;
        for (const fn of listeners.open ?? []) fn({});
      },
      close() {
        this.readyState = CLOSED;
        for (const fn of listeners.close ?? []) fn({});
      },
      message(data: unknown) {
        for (const fn of listeners.message ?? []) fn({ data: JSON.stringify(data) });
      },
    };
    // The client calls addEventListener('open'|'message'|'close'|'error').
    (
      sock as unknown as { addEventListener: (t: string, fn: (ev: unknown) => void) => void }
    ).addEventListener = (type: string, fn: (ev: unknown) => void) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    };
    sockets.push(sock);
    return sock as unknown as WebSocket;
  };
  return { factory, sockets };
}

function handler(): FeedbackHandler & {
  events: unknown[];
  resets: number;
} {
  const events: unknown[] = [];
  let resets = 0;
  return {
    events,
    get resets() {
      return resets;
    },
    onEvent(e) {
      events.push(e);
    },
    onDone() {},
    onError() {},
    onReset() {
      resets += 1;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('reconnect: onReset before re-subscribe', () => {
  it('does NOT reset on the initial connect, DOES reset (before re-subscribe) on reconnect', () => {
    const { factory, sockets } = makeFakeSocketFactory();
    const client = new WidgetWsClient('ws://x', factory);
    const h = handler();

    client.subscribe('fb-1', h);
    const first = sockets[0];
    expect(first).toBeDefined();

    // Initial connect: open → subscribe sent, NO reset.
    first?.open();
    expect(h.resets).toBe(0);
    expect(first?.sent.some((m) => m.includes('"subscribe"'))).toBe(true);

    // Drop the socket → backoff reconnect.
    first?.close();
    vi.advanceTimersByTime(1_000);
    const second = sockets[1];
    expect(second).toBeDefined();

    // Reconnect open: onReset fires, and it fires BEFORE the re-subscribe is
    // put on the new socket (the invariant the wipe-then-replay relies on).
    const order: string[] = [];
    const origReset = h.onReset;
    h.onReset = () => {
      order.push('reset');
      origReset?.();
    };
    const origSend = second?.send.bind(second);
    if (second && origSend) {
      second.send = (p: string) => {
        if (p.includes('"subscribe"')) order.push('subscribe');
        origSend(p);
      };
    }
    second?.open();

    expect(h.resets).toBe(1);
    expect(order).toEqual(['reset', 'subscribe']);
  });
});

describe('outbound queue drains on reconnect', () => {
  it('messages sent while the socket is down are queued and flushed on open', () => {
    const { factory, sockets } = makeFakeSocketFactory();
    const client = new WidgetWsClient('ws://x', factory);
    const h = handler();
    client.subscribe('fb-1', h);
    const sock = sockets[0];

    // Socket still CONNECTING — a user message is queued, not sent.
    client.sendUserMessage('fb-1', 'hello');
    expect(sock?.sent.some((m) => m.includes('hello'))).toBe(false);

    // On open the queue drains.
    sock?.open();
    expect(sock?.sent.some((m) => m.includes('hello'))).toBe(true);
  });

  it('re-queues across a reconnect: a send while down lands after the new socket opens', () => {
    const { factory, sockets } = makeFakeSocketFactory();
    const client = new WidgetWsClient('ws://x', factory);
    const h = handler();
    client.subscribe('fb-1', h);
    sockets[0]?.open();
    sockets[0]?.close();

    // Down between sockets — this queues.
    client.sendUserMessage('fb-1', 'after-drop');
    vi.advanceTimersByTime(1_000);
    const second = sockets[1];
    second?.open();
    expect(second?.sent.some((m) => m.includes('after-drop'))).toBe(true);
  });
});

describe('explicit close never reconnects', () => {
  it('unsubscribing the last handler closes the socket and no reconnect is scheduled', () => {
    const { factory, sockets } = makeFakeSocketFactory();
    const client = new WidgetWsClient('ws://x', factory);
    const h = handler();
    client.subscribe('fb-1', h);
    sockets[0]?.open();

    // Explicit teardown: last handler gone → closeIdle() marks explicitlyClosed.
    client.unsubscribe('fb-1');
    sockets[0]?.close();

    // Advance well past any backoff — no new socket is ever created.
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('a transport-driven drop (handler still subscribed) DOES reconnect', () => {
    const { factory, sockets } = makeFakeSocketFactory();
    const client = new WidgetWsClient('ws://x', factory);
    const h = handler();
    client.subscribe('fb-1', h);
    sockets[0]?.open();

    // Network drop, not an explicit close — handler is still subscribed.
    sockets[0]?.close();
    vi.advanceTimersByTime(1_000);
    expect(sockets.length).toBeGreaterThan(1);
  });
});
