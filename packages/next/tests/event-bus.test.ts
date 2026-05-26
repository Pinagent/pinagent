// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentEvent,
  type BusSubscriber,
  finishBus,
  getBus,
  getOrCreateBus,
} from '../src/event-bus';

// The module holds `buses` in a top-level Map. Each test uses a unique
// id (via the test name) so module-level singletons don't bleed.
let nextId = 0;
const newId = () => `t-${++nextId}-${Date.now()}`;

const initEvent: AgentEvent = {
  type: 'init',
  sessionId: 'sess-1',
  model: 'claude-opus-4-7',
  permissionMode: 'acceptEdits',
  apiKeySource: 'oauth',
};
const textEvent: AgentEvent = { type: 'text', text: 'hello' };
const resultEvent: AgentEvent = {
  type: 'result',
  subtype: 'success',
  numTurns: 1,
  totalCostUsd: 0.01,
  durationMs: 1000,
};

function spySubscriber(): BusSubscriber & { events: AgentEvent[]; closed: boolean } {
  const events: AgentEvent[] = [];
  let closed = false;
  return {
    events,
    get closed() {
      return closed;
    },
    onEvent(e) {
      events.push(e);
    },
    onClose() {
      closed = true;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('event-bus', () => {
  it('publishes events to subscribers in order', () => {
    const id = newId();
    const bus = getOrCreateBus(id);
    const sub = spySubscriber();
    bus.subscribe(sub);
    bus.publish(initEvent);
    bus.publish(textEvent);
    expect(sub.events).toEqual([initEvent, textEvent]);
  });

  it('replays buffered events to a late subscriber, then continues live', () => {
    const id = newId();
    const bus = getOrCreateBus(id);
    bus.publish(initEvent);
    bus.publish(textEvent);

    const sub = spySubscriber();
    bus.subscribe(sub);
    expect(sub.events).toEqual([initEvent, textEvent]);

    bus.publish(resultEvent);
    expect(sub.events).toEqual([initEvent, textEvent, resultEvent]);
  });

  it('fans out live events to multiple subscribers', () => {
    const id = newId();
    const bus = getOrCreateBus(id);
    const a = spySubscriber();
    const b = spySubscriber();
    bus.subscribe(a);
    bus.subscribe(b);
    bus.publish(textEvent);
    expect(a.events).toEqual([textEvent]);
    expect(b.events).toEqual([textEvent]);
  });

  it('a throwing subscriber does not stop other subscribers from receiving events', () => {
    const id = newId();
    const bus = getOrCreateBus(id);
    const ok = spySubscriber();
    const throwy: BusSubscriber = {
      onEvent() {
        throw new Error('boom');
      },
      onClose() {},
    };
    bus.subscribe(throwy);
    bus.subscribe(ok);
    bus.publish(textEvent);
    expect(ok.events).toEqual([textEvent]);
  });

  it('unsubscribe stops further events but leaves prior ones intact', () => {
    const id = newId();
    const bus = getOrCreateBus(id);
    const sub = spySubscriber();
    const unsub = bus.subscribe(sub);
    bus.publish(textEvent);
    unsub();
    bus.publish(resultEvent);
    expect(sub.events).toEqual([textEvent]);
  });

  it('finishBus calls onClose on all subscribers and ignores further publishes', () => {
    const id = newId();
    const bus = getOrCreateBus(id);
    const sub = spySubscriber();
    bus.subscribe(sub);
    bus.publish(textEvent);
    finishBus(id);
    expect(sub.closed).toBe(true);
    bus.publish(resultEvent);
    expect(sub.events).toEqual([textEvent]);
  });

  it('subscribing to a finished bus replays buffer then closes immediately', () => {
    const id = newId();
    const bus = getOrCreateBus(id);
    bus.publish(initEvent);
    bus.publish(textEvent);
    finishBus(id);

    const sub = spySubscriber();
    bus.subscribe(sub);
    expect(sub.events).toEqual([initEvent, textEvent]);
    expect(sub.closed).toBe(true);
  });

  it('finishBus evicts the bus after the 5-minute TTL', () => {
    const id = newId();
    getOrCreateBus(id);
    expect(getBus(id)).toBeDefined();
    finishBus(id);
    // Still present during TTL window.
    expect(getBus(id)).toBeDefined();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(getBus(id)).toBeUndefined();
  });

  it('getOrCreateBus is idempotent — same id returns same instance', () => {
    const id = newId();
    const a = getOrCreateBus(id);
    const b = getOrCreateBus(id);
    expect(a).toBe(b);
  });

  it('getBus returns undefined for unknown ids', () => {
    expect(getBus(`nope-${Date.now()}`)).toBeUndefined();
  });

  it('finishBus on an unknown id is a no-op', () => {
    expect(() => finishBus(`nope-${Date.now()}`)).not.toThrow();
  });

  it('a second finishBus on the same id is a no-op (no double-close)', () => {
    const id = newId();
    getOrCreateBus(id);
    const sub = spySubscriber();
    let closeCount = 0;
    const counting: BusSubscriber = {
      onEvent: () => {},
      onClose: () => {
        closeCount += 1;
      },
    };
    getBus(id)?.subscribe(counting);
    void sub;
    finishBus(id);
    finishBus(id);
    expect(closeCount).toBe(1);
  });
});
