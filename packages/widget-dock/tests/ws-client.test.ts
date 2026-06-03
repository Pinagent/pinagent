// SPDX-License-Identifier: Apache-2.0
/**
 * DockWsClient reconnect behaviour. The server replays a conversation's
 * full transcript from the start on every fresh `subscribe`, so when the
 * socket drops and the client re-subscribes, an accumulating consumer
 * would render the whole transcript twice. The client must fire
 * `onReset` before re-subscribing on a reconnect — and must NOT fire it
 * on the initial connect (nothing to reset).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ConversationHandlers, DockWsClient } from '../src/transport/ws-client';

/** Minimal controllable WebSocket stand-in. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    const s = FakeWebSocket.instances.at(-1);
    if (!s) throw new Error('no socket constructed');
    return s;
  }

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (e: unknown) => void): void {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = this.CLOSED;
    this.emit('close');
  }

  // --- test drivers ---
  open(): void {
    this.readyState = this.OPEN;
    this.emit('open');
  }
  dropFromServer(): void {
    this.readyState = this.CLOSED;
    this.emit('close');
  }
  deliver(message: object): void {
    this.emit('message', { data: JSON.stringify(message) });
  }
  private emit(type: string, e: unknown = {}): void {
    for (const cb of this.listeners[type] ?? []) cb(e);
  }

  sentTypes(): string[] {
    return this.sent.map((s) => (JSON.parse(s) as { type: string }).type);
  }
}

function makeHandlers(over: Partial<ConversationHandlers> = {}): ConversationHandlers {
  return {
    onEvent() {},
    onWorktreeState() {},
    onError() {},
    onDone() {},
    ...over,
  };
}

let originalWebSocket: unknown;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
});

afterEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
  vi.useRealTimers();
});

describe('DockWsClient reconnect', () => {
  it('does not duplicate the replayed transcript: resets on reconnect, not on first connect', () => {
    const events: string[] = [];
    let resets = 0;
    const order: string[] = [];

    const client = new DockWsClient('ws://test/__pinagent/ws');
    client.subscribeConversation(
      'cv1',
      makeHandlers({
        onEvent(e) {
          if (e.type === 'text') events.push(e.text);
        },
        onReset() {
          resets++;
          order.push('reset');
        },
      }),
    );

    // Initial connect → no reset, then the server replays A, B.
    const first = FakeWebSocket.last();
    first.open();
    expect(resets).toBe(0);
    first.deliver({ type: 'event', feedbackId: 'cv1', event: { type: 'text', text: 'A' } });
    first.deliver({ type: 'event', feedbackId: 'cv1', event: { type: 'text', text: 'B' } });
    expect(events).toEqual(['A', 'B']);

    // Drop → backoff reconnect → new socket.
    first.dropFromServer();
    vi.advanceTimersByTime(1_000);
    const second = FakeWebSocket.last();
    expect(second).not.toBe(first);

    // Reconnect open → reset fires BEFORE the re-subscribe is sent.
    order.length = 0;
    second.open();
    second.deliver({ type: 'event', feedbackId: 'cv1', event: { type: 'text', text: 'A' } });
    second.deliver({ type: 'event', feedbackId: 'cv1', event: { type: 'text', text: 'B' } });

    expect(resets).toBe(1);
    // The consumer that clears on reset would now hold [A, B], not
    // [A, B, A, B]. We assert the reset happened on this socket and that
    // it re-subscribed.
    expect(second.sentTypes()).toContain('subscribe');
  });

  it('fires onReset before sending the re-subscribe on reconnect', () => {
    const timeline: string[] = [];
    const client = new DockWsClient('ws://test/__pinagent/ws');
    // Spy on send ordering by tagging reset vs the subscribe frame.
    client.subscribeConversation(
      'cv1',
      makeHandlers({
        onReset() {
          timeline.push('reset');
        },
      }),
    );

    const first = FakeWebSocket.last();
    first.open();
    first.dropFromServer();
    vi.advanceTimersByTime(1_000);

    const second = FakeWebSocket.last();
    const origSend = second.send.bind(second);
    second.send = (payload: string) => {
      const { type } = JSON.parse(payload) as { type: string; feedbackId?: string };
      if (type === 'subscribe') timeline.push('subscribe');
      origSend(payload);
    };
    second.open();

    expect(timeline.indexOf('reset')).toBeGreaterThanOrEqual(0);
    expect(timeline.indexOf('reset')).toBeLessThan(timeline.indexOf('subscribe'));
  });

  it('surfaces a connection-level error (no feedbackId) instead of dropping it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onError = vi.fn();
    const client = new DockWsClient('ws://test/__pinagent/ws');
    client.subscribeConversation('cv1', makeHandlers({ onError }));
    const sock = FakeWebSocket.last();
    sock.open();

    sock.deliver({ type: 'error', message: 'relay disconnected' });

    expect(warn).toHaveBeenCalledWith('[pinagent] server error:', 'relay disconnected');
    // Not routed to a specific conversation handler (there's no feedbackId).
    expect(onError).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
