// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * `deriveEffectiveStatus` keeps the dock's status badge aligned with the
 * in-page widget by reconstructing the conversation status from the live
 * event stream, rather than waiting for the cached HTTP status to refetch.
 * The regression these cover: a finished run (a live `status_changed` /
 * `result` in the stream) used to leave the badge stuck on "Working"
 * because the old derivation only looked at the last item for an
 * `ask_user`.
 */
import type { AgentEvent } from '@pinagent/shared';
import type { StatusKey } from '@pinagent/ui/tokens';
import { describe, expect, it } from 'vitest';

import type { StreamItem } from '../src/hooks/useConversationStream';
import { deriveEffectiveStatus } from '../src/routes/Conversations';
import type { WorktreeStatePayload } from '../src/transport';

const NO_ASKED: ReadonlySet<string> = new Set();

let nextId = 0;
function ev(event: Partial<AgentEvent> & { type: AgentEvent['type'] }): StreamItem {
  return {
    kind: 'event',
    id: ++nextId,
    event: event as AgentEvent,
    receivedAt: new Date(2024, 0, 1, 0, 0, ++nextId).toISOString(),
  };
}

const init = (): StreamItem => ev({ type: 'init' });
const text = (): StreamItem => ev({ type: 'text', text: 'working' } as Partial<AgentEvent>);
const result = (): StreamItem =>
  ev({ type: 'result', numTurns: 8, durationMs: 1, totalCostUsd: 0 } as Partial<AgentEvent>);
const statusChanged = (status: 'fixed' | 'wontfix' | 'deferred' | 'pending'): StreamItem =>
  ev({ type: 'status_changed', status } as Partial<AgentEvent>);
const askUser = (askId: string): StreamItem =>
  ev({ type: 'ask_user', askId, question: 'q' } as Partial<AgentEvent>);

const NO_WT: WorktreeStatePayload | null = null;

describe('deriveEffectiveStatus', () => {
  it('shows working while a run is in flight (pending base + activity)', () => {
    const items = [init(), text()];
    expect(deriveEffectiveStatus('pending', items, NO_ASKED, NO_WT)).toBe('working');
  });

  it('flips to readyToLand when the run resolves fixed in the live stream', () => {
    // The whole point: a `status_changed: fixed` (plus the trailing
    // `result`) must move the badge off "working" before the cached
    // status refetches — matching the widget's "Done / Resolved (fixed)".
    const items = [init(), text(), statusChanged('fixed'), result()];
    expect(deriveEffectiveStatus('pending', items, NO_ASKED, NO_WT)).toBe('readyToLand');
  });

  it('maps wontfix → discarded and deferred → awaitingClarification', () => {
    expect(
      deriveEffectiveStatus('pending', [init(), statusChanged('wontfix')], NO_ASKED, NO_WT),
    ).toBe('discarded');
    expect(
      deriveEffectiveStatus('pending', [init(), statusChanged('deferred')], NO_ASKED, NO_WT),
    ).toBe('awaitingClarification');
  });

  it('returns to working when a new turn (init) starts after a prior resolution', () => {
    // deferred → user replied → fresh turn. The newest init wins, so we
    // must not stay stuck on the stale `deferred`.
    const items = [init(), statusChanged('deferred'), init(), text()];
    expect(deriveEffectiveStatus('pending', items, NO_ASKED, NO_WT)).toBe('working');
  });

  it('shows awaitingClarification for a trailing unanswered ask_user', () => {
    const items = [init(), askUser('a1')];
    expect(deriveEffectiveStatus('pending', items, NO_ASKED, NO_WT)).toBe('awaitingClarification');
  });

  it('treats an answered ask_user as working (optimistic gap)', () => {
    const items = [init(), askUser('a1')];
    expect(deriveEffectiveStatus('pending', items, new Set(['a1']), NO_WT)).toBe('working');
  });

  it('lets a live landed/discarded worktree transition win outright', () => {
    const items = [init(), text()];
    expect(
      deriveEffectiveStatus('pending', items, NO_ASKED, {
        state: 'landed',
      } as WorktreeStatePayload),
    ).toBe('landed');
    expect(
      deriveEffectiveStatus('pending', items, NO_ASKED, {
        state: 'discarded',
      } as WorktreeStatePayload),
    ).toBe('discarded');
  });

  it('keeps terminal cached statuses', () => {
    const cached: StatusKey[] = ['landed', 'discarded', 'error', 'readyToLand'];
    for (const base of cached) {
      expect(deriveEffectiveStatus(base, [init(), text()], NO_ASKED, NO_WT)).toBe(base);
    }
  });

  it('falls back to the cached base when the stream is empty', () => {
    expect(deriveEffectiveStatus('pending', [], NO_ASKED, NO_WT)).toBe('pending');
  });
});
