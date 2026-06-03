// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createFollowupQueue, isTurnBusyError } from '../src/routes/followup-queue';

describe('createFollowupQueue', () => {
  it('sends immediately when the turn is idle', () => {
    const q = createFollowupQueue();
    expect(q.submit('hi', false)).toBe(true);
    expect(q.size).toBe(0);
  });

  it('parks a reply while a turn is running', () => {
    const q = createFollowupQueue();
    expect(q.submit('one', true)).toBe(false);
    expect(q.submit('two', true)).toBe(false);
    expect(q.size).toBe(2);
  });

  it('drains parked replies FIFO at turn-end, one per call', () => {
    const q = createFollowupQueue();
    q.submit('one', true);
    q.submit('two', true);
    expect(q.nextOnTurnEnd()).toBe('one');
    expect(q.nextOnTurnEnd()).toBe('two');
    expect(q.nextOnTurnEnd()).toBeNull();
  });

  it('re-queues a bounced send at the FRONT so it retries first', () => {
    const q = createFollowupQueue();
    q.submit('later', true);
    q.requeue('bounced');
    expect(q.nextOnTurnEnd()).toBe('bounced');
    expect(q.nextOnTurnEnd()).toBe('later');
  });
});

describe('isTurnBusyError', () => {
  it('matches the server bounce message, case-insensitively', () => {
    expect(isTurnBusyError('a turn is already in progress')).toBe(true);
    expect(isTurnBusyError('Turn already in progress')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isTurnBusyError('agent crashed')).toBe(false);
    expect(isTurnBusyError('rate limited')).toBe(false);
  });
});
