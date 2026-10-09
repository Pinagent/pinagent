// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  awaitingHeadline,
  cardAwaitingLabel,
  formatCountdown,
  formatElapsed,
  formatRemaining,
  parseTime,
  trayAwaitingMeta,
  trayAwaitingTitle,
} from '../src/awaiting';

const T0 = Date.parse('2026-10-08T10:00:00.000Z');

describe('awaiting labels', () => {
  it('words a permission prompt as "Approve?" and a question as needing input', () => {
    expect(awaitingHeadline('permission')).toBe('Approve?');
    expect(awaitingHeadline('question')).toBe('Needs your input');
  });

  it('formats elapsed time coarsely and clamps negatives', () => {
    expect(formatElapsed(-5)).toBe('0s');
    expect(formatElapsed(42_000)).toBe('42s');
    expect(formatElapsed(5 * 60_000 + 30_000)).toBe('5m');
    expect(formatElapsed(65 * 60_000)).toBe('1h 5m');
    expect(formatElapsed(120 * 60_000)).toBe('2h');
  });

  it('rounds time remaining up', () => {
    expect(formatRemaining(119_000)).toBe('2m');
    expect(formatRemaining(120_000)).toBe('2m');
    expect(formatRemaining(30_400)).toBe('31s');
  });

  it('formats a clock countdown and clamps at zero', () => {
    expect(formatCountdown(245_000)).toBe('4:05');
    expect(formatCountdown(500)).toBe('0:01');
    expect(formatCountdown(-1)).toBe('0:00');
  });

  it('counts the card label down to the auto-deny, then drops the countdown', () => {
    const ask = { kind: 'permission' as const, expiresAt: T0 + 5 * 60_000 };
    expect(cardAwaitingLabel(ask, T0 + 55_000)).toBe('Approve? · auto-deny in 4:05');
    expect(cardAwaitingLabel(ask, T0 + 5 * 60_000)).toBe('Approve?');
    expect(cardAwaitingLabel({ kind: 'question', expiresAt: T0 + 60_000 }, T0)).toBe(
      'Needs your input · closes in 1:00',
    );
    expect(cardAwaitingLabel({ kind: 'question', expiresAt: null }, T0)).toBe('Needs your input');
  });

  it('shows how long a tray row has been waiting, with the time left in its tooltip', () => {
    const ask = {
      askId: 'a',
      kind: 'permission' as const,
      since: T0,
      expiresAt: T0 + 5 * 60_000,
    };
    expect(trayAwaitingMeta(ask, T0 + 3 * 60_000)).toBe('Approve? · waiting 3m');
    expect(trayAwaitingTitle(ask, T0 + 3 * 60_000)).toBe(
      'The agent is waiting for you to approve a tool call · auto-denies in 2m',
    );
    expect(trayAwaitingMeta({ ...ask, since: null }, T0)).toBe('Approve?');
  });

  it('parses ISO times, rejecting junk', () => {
    expect(parseTime('2026-10-08T10:00:00.000Z')).toBe(T0);
    expect(parseTime('nope')).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });
});
