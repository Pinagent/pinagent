// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { deriveDockStatus, isUnresolvedStatus } from '../src/dock-status';

describe('deriveDockStatus', () => {
  it('maps worktree landed/discarded regardless of status', () => {
    expect(deriveDockStatus('pending', 'landed')).toBe('landed');
    expect(deriveDockStatus('fixed', 'landed')).toBe('landed');
    expect(deriveDockStatus('pending', 'discarded')).toBe('discarded');
  });

  it('maps wontfix to discarded', () => {
    expect(deriveDockStatus('wontfix', 'none')).toBe('discarded');
    expect(deriveDockStatus('wontfix', 'active')).toBe('discarded');
  });

  it('maps deferred to awaitingClarification', () => {
    expect(deriveDockStatus('deferred', 'none')).toBe('awaitingClarification');
    expect(deriveDockStatus('deferred', 'active')).toBe('awaitingClarification');
  });

  it('maps fixed to readyToLand (with or without a worktree)', () => {
    expect(deriveDockStatus('fixed', 'active')).toBe('readyToLand');
    expect(deriveDockStatus('fixed', 'none')).toBe('readyToLand');
  });

  it('maps an active worktree with pending status to working', () => {
    expect(deriveDockStatus('pending', 'active')).toBe('working');
  });

  it('maps a fresh pending conversation with no worktree to pending', () => {
    expect(deriveDockStatus('pending', 'none')).toBe('pending');
  });

  it('maps a running inline-mode row (pending, none) to working', () => {
    // The case the running-agents tray cares about: without isRunning this
    // is the terminal `pending` and would never surface.
    expect(deriveDockStatus('pending', 'none', true)).toBe('working');
  });

  it('lets isRunning override an otherwise-resolved status (live follow-up)', () => {
    expect(deriveDockStatus('fixed', 'none', true)).toBe('working');
    expect(deriveDockStatus('deferred', 'active', true)).toBe('working');
  });

  it('defaults isRunning to false (unchanged two-axis behavior)', () => {
    expect(deriveDockStatus('pending', 'none')).toBe('pending');
    expect(deriveDockStatus('pending', 'none', false)).toBe('pending');
  });
});

describe('isUnresolvedStatus', () => {
  it('is true for the three actionable statuses', () => {
    expect(isUnresolvedStatus('working')).toBe(true);
    expect(isUnresolvedStatus('readyToLand')).toBe(true);
    expect(isUnresolvedStatus('awaitingClarification')).toBe(true);
  });

  it('is false for terminal and out-of-band statuses', () => {
    expect(isUnresolvedStatus('pending')).toBe(false);
    expect(isUnresolvedStatus('landed')).toBe(false);
    expect(isUnresolvedStatus('discarded')).toBe(false);
    expect(isUnresolvedStatus('error')).toBe(false);
    expect(isUnresolvedStatus('anchorLost')).toBe(false);
  });
});
