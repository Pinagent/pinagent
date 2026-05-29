// SPDX-License-Identifier: Apache-2.0

import type { ServerStatus } from '@pinagent/shared';
import type { StatusKey } from '@pinagent/ui/tokens';
import type { StreamItem } from '../hooks/useConversationStream';
import type { WorktreeStatePayload } from '../transport';

/**
 * Map a `resolve_feedback` status carried on a live `status_changed`
 * event into the dock's status vocabulary. Mirrors the status axis of
 * `deriveDockStatus` (the worktree axis is handled by the caller, which
 * has the live worktree state). `pending` carries no resolution signal,
 * so it returns null and the caller falls through to its working/cached
 * derivation.
 */
function mapResolvedStatus(status: ServerStatus): StatusKey | null {
  switch (status) {
    case 'fixed':
      return 'readyToLand';
    case 'wontfix':
      return 'discarded';
    case 'deferred':
      return 'awaitingClarification';
    default:
      return null;
  }
}

/**
 * Override the server-cached status with live signal from the event
 * stream. The server only flips `status` on a terminal `resolve_feedback`
 * call, and the dock's cached copy of it (`base`) only refreshes when a
 * `conversations_changed` project event invalidates the detail query —
 * so between the agent resolving and that refetch landing, `base` sits at
 * a stale `pending`. The in-page widget, by contrast, reacts to the live
 * `result` / `status_changed` events the moment they arrive and shows
 * "Done". To keep the two surfaces aligned we reconstruct the status from
 * the live stream the same way:
 *
 *   - A live `status_changed` is an explicit resolution: `fixed` →
 *     readyToLand, `wontfix` → discarded, `deferred` → awaiting. This is
 *     what previously kept the badge stuck on "Working" after the agent
 *     finished — the old derivation ignored `status_changed` entirely.
 *   - An unanswered `ask_user` means we're awaiting clarification.
 *   - A fresh `init` after either of the above means a new turn started,
 *     so we're back to working — hence we stop at the first `init` when
 *     walking from the newest item.
 *   - Otherwise `pending` + any agent activity ⇒ working.
 *
 * A live `landed` / `discarded` worktree transition is an explicit
 * lifecycle decision and wins outright (the worktree state arrives over
 * the same stream, ahead of the cached-status refetch). `answeredAskIds`
 * covers the optimistic gap between the user answering and the agent's
 * next event. Terminal cached statuses still win over working/awaiting
 * live signal.
 */
export function deriveEffectiveStatus(
  base: StatusKey,
  items: readonly StreamItem[],
  answeredAskIds: ReadonlySet<string>,
  worktreeState: WorktreeStatePayload | null,
): StatusKey {
  if (worktreeState?.state === 'landed') return 'landed';
  if (worktreeState?.state === 'discarded') return 'discarded';
  if (base === 'landed' || base === 'discarded' || base === 'error' || base === 'readyToLand') {
    return base;
  }
  // Walk newest → oldest for the most recent decisive lifecycle event.
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (!it || it.kind !== 'event') continue;
    const ev = it.event;
    if (ev.type === 'init') break;
    if (ev.type === 'status_changed') {
      const mapped = mapResolvedStatus(ev.status);
      if (mapped) return mapped;
    }
    if (ev.type === 'ask_user') {
      return answeredAskIds.has(ev.askId) ? 'working' : 'awaitingClarification';
    }
  }
  if (base === 'pending' && items.length > 0) return 'working';
  return base;
}
