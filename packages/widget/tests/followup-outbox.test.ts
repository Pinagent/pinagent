// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFollowUpQueue, loadFollowUpQueue, saveFollowUpQueue } from '../src/followup-outbox';
import type { QueuedFollowUp } from '../src/types';

// Ticket 004: the client-side follow-up queue is mirrored to a localStorage
// outbox (key `pinagent:followups:<feedbackId>`) so it survives a page
// reload — the one piece of conversation state the server can't rebuild.

const FB = 'fb-abc123';
const KEY = `pinagent:followups:${FB}`;

const node: QueuedFollowUp['node'] = {
  file: 'src/Foo.tsx',
  line: 42,
  col: 7,
  selector: 'main > button',
  component: 'Foo',
  tag: 'button',
};

describe('follow-up outbox round-trip', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists and reloads queued follow-ups in order', () => {
    const queue: QueuedFollowUp[] = [{ content: 'first' }, { content: 'second' }];
    saveFollowUpQueue(localStorage, FB, queue);
    expect(loadFollowUpQueue(localStorage, FB)).toEqual(queue);
  });

  it('preserves the picked-element anchor payload (not a DOM node)', () => {
    const queue: QueuedFollowUp[] = [{ content: 'change this', node }];
    saveFollowUpQueue(localStorage, FB, queue);
    const restored = loadFollowUpQueue(localStorage, FB);
    expect(restored).toEqual(queue);
    expect(restored[0]?.node).toEqual(node);
  });

  it('returns an empty array for a conversation with nothing persisted', () => {
    expect(loadFollowUpQueue(localStorage, 'never-seen')).toEqual([]);
  });

  it('removes the key entirely when the queue drains to empty', () => {
    saveFollowUpQueue(localStorage, FB, [{ content: 'pending' }]);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    saveFollowUpQueue(localStorage, FB, []);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('clearFollowUpQueue drops the persisted entry (dismiss / terminal resolve)', () => {
    saveFollowUpQueue(localStorage, FB, [{ content: 'pending' }]);
    clearFollowUpQueue(localStorage, FB);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadFollowUpQueue(localStorage, FB)).toEqual([]);
  });

  it('keys per-conversation so one feedbackId never clobbers another', () => {
    saveFollowUpQueue(localStorage, 'fb-1', [{ content: 'one' }]);
    saveFollowUpQueue(localStorage, 'fb-2', [{ content: 'two' }]);
    expect(loadFollowUpQueue(localStorage, 'fb-1')).toEqual([{ content: 'one' }]);
    expect(loadFollowUpQueue(localStorage, 'fb-2')).toEqual([{ content: 'two' }]);
    clearFollowUpQueue(localStorage, 'fb-1');
    expect(loadFollowUpQueue(localStorage, 'fb-1')).toEqual([]);
    expect(loadFollowUpQueue(localStorage, 'fb-2')).toEqual([{ content: 'two' }]);
  });
});

describe('follow-up outbox tolerance', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('ignores malformed JSON rather than throwing', () => {
    localStorage.setItem(KEY, '{not valid json');
    expect(loadFollowUpQueue(localStorage, FB)).toEqual([]);
  });

  it('ignores a non-array payload', () => {
    localStorage.setItem(KEY, JSON.stringify({ content: 'oops' }));
    expect(loadFollowUpQueue(localStorage, FB)).toEqual([]);
  });

  it('drops entries that lack a string content field', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ content: 'keep' }, { node }, { content: 5 }, null, 'x']),
    );
    expect(loadFollowUpQueue(localStorage, FB)).toEqual([{ content: 'keep' }]);
  });

  it('save is best-effort: a throwing storage never propagates', () => {
    const throwing = {
      getItem: () => null,
      setItem() {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
    };
    expect(() => saveFollowUpQueue(throwing, FB, [{ content: 'x' }])).not.toThrow();
  });
});
