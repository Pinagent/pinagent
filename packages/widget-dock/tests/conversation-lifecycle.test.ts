// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the land/discard/reopen state machine that drives the detail
 * view's lifecycle UI. The reducer + timeout helpers in
 * `conversation-lifecycle.ts` are the decision logic behind the two
 * `useEffect`s in `Conversations.tsx`; the failure mode they guard
 * against is the worst kind — a failed land that looks successful
 * because the UI never cleared the spinner, or a real success that
 * stays "Landing…" forever.
 *
 * Pure functions, plain vitest — no React, no fake DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  LIFECYCLE_TIMEOUT_MS,
  type LifecycleIntent,
  lifecycleTimeoutState,
  reduceLifecycleOnWorktreeState,
} from '../src/routes/conversation-lifecycle';

const LAND: LifecycleIntent = { kind: 'land', sentAt: 1_000 };
const DISCARD: LifecycleIntent = { kind: 'discard', sentAt: 1_000 };
const REOPEN: LifecycleIntent = { kind: 'reopen', sentAt: 1_000 };

describe('reduceLifecycleOnWorktreeState', () => {
  it('returns null when there is no intent (UI idle, transitions ignored)', () => {
    expect(reduceLifecycleOnWorktreeState(null, 'landed', 0)).toBeNull();
    expect(reduceLifecycleOnWorktreeState(null, 'conflict', 3)).toBeNull();
  });

  describe('land', () => {
    it('clears intent + error on terminal `landed`', () => {
      expect(reduceLifecycleOnWorktreeState(LAND, 'landed', 0)).toEqual({
        intent: null,
        error: null,
      });
    });

    it('surfaces a conflict error with the file count (singular)', () => {
      expect(reduceLifecycleOnWorktreeState(LAND, 'conflict', 1)).toEqual({
        intent: null,
        error: { kind: 'land', message: 'Land failed — 1 file in conflict.' },
      });
    });

    it('surfaces a conflict error with the file count (plural)', () => {
      expect(reduceLifecycleOnWorktreeState(LAND, 'conflict', 4)).toEqual({
        intent: null,
        error: { kind: 'land', message: 'Land failed — 4 files in conflict.' },
      });
    });

    it('ignores transient `landing` — intent persists, spinner stays', () => {
      expect(reduceLifecycleOnWorktreeState(LAND, 'landing', 0)).toBeNull();
    });

    it("does NOT react to another kind's terminal state (no cross-talk)", () => {
      // A `discarded` event while a `land` is in flight shouldn't clear
      // the land intent — that would silently mask a stuck land.
      expect(reduceLifecycleOnWorktreeState(LAND, 'discarded', 0)).toBeNull();
      expect(reduceLifecycleOnWorktreeState(LAND, 'none', 0)).toBeNull();
    });
  });

  describe('discard', () => {
    it('clears intent + error on terminal `discarded`', () => {
      expect(reduceLifecycleOnWorktreeState(DISCARD, 'discarded', 0)).toEqual({
        intent: null,
        error: null,
      });
    });

    it('ignores transient `discarding`', () => {
      expect(reduceLifecycleOnWorktreeState(DISCARD, 'discarding', 0)).toBeNull();
    });

    it("does NOT react to land's terminal states", () => {
      expect(reduceLifecycleOnWorktreeState(DISCARD, 'landed', 0)).toBeNull();
      expect(reduceLifecycleOnWorktreeState(DISCARD, 'conflict', 1)).toBeNull();
    });
  });

  describe('reopen', () => {
    it('clears intent + error on terminal `none` (no transient phase)', () => {
      expect(reduceLifecycleOnWorktreeState(REOPEN, 'none', 0)).toEqual({
        intent: null,
        error: null,
      });
    });

    it('does NOT react to other terminal states', () => {
      expect(reduceLifecycleOnWorktreeState(REOPEN, 'landed', 0)).toBeNull();
      expect(reduceLifecycleOnWorktreeState(REOPEN, 'discarded', 0)).toBeNull();
      expect(reduceLifecycleOnWorktreeState(REOPEN, 'conflict', 1)).toBeNull();
    });
  });

  it('handles unknown worktree-state strings as no-op (forward-compat)', () => {
    // If the server adds a new transient state, the dock shouldn't
    // clear intent — it should keep waiting for a known terminal.
    expect(reduceLifecycleOnWorktreeState(LAND, 'rebasing', 0)).toBeNull();
    expect(reduceLifecycleOnWorktreeState(LAND, null, 0)).toBeNull();
  });
});

describe('lifecycleTimeoutState', () => {
  it('returns null when there is no intent', () => {
    expect(lifecycleTimeoutState(null, 5_000_000)).toBeNull();
  });

  it('returns null when the timeout has not elapsed', () => {
    // sentAt 1000, now 1000 + 9999 — one ms shy of the 10s window.
    expect(lifecycleTimeoutState(LAND, 1_000 + 9_999)).toBeNull();
  });

  it('fires at exactly the timeout boundary', () => {
    expect(lifecycleTimeoutState(LAND, 1_000 + LIFECYCLE_TIMEOUT_MS)).toEqual({
      intent: null,
      error: {
        kind: 'land',
        message: 'No response from the dev-server within 10s.',
      },
    });
  });

  it('fires past the boundary too (covers tab-throttled wakeups)', () => {
    expect(lifecycleTimeoutState(LAND, 1_000 + 30_000)).toEqual({
      intent: null,
      error: {
        kind: 'land',
        message: 'No response from the dev-server within 10s.',
      },
    });
  });

  it('uses the intent kind in the error so the Retry button calls the right action', () => {
    expect(lifecycleTimeoutState(LAND, 1_000 + 11_000)?.error?.kind).toBe('land');
    expect(lifecycleTimeoutState(DISCARD, 1_000 + 11_000)?.error?.kind).toBe('discard');
    expect(lifecycleTimeoutState(REOPEN, 1_000 + 11_000)?.error?.kind).toBe('reopen');
  });

  it('respects a custom timeoutMs (overridable for tests)', () => {
    expect(lifecycleTimeoutState(LAND, 1_000 + 500, 1_000)).toBeNull();
    expect(lifecycleTimeoutState(LAND, 1_000 + 1_000, 1_000)).toEqual({
      intent: null,
      error: {
        kind: 'land',
        message: 'No response from the dev-server within 1s.',
      },
    });
  });
});
