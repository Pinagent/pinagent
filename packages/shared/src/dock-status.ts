// SPDX-License-Identifier: Apache-2.0
/**
 * Map the server's two-axis (status, worktreeState) representation into
 * the dock's single-axis status enum. The server's storage shape is
 * older than the dock's vocabulary — they overlap but don't match 1:1,
 * and consumers (dock badges, the widget's running-agents tray) need the
 * single-axis form for badge color, filtering, and the "unresolved"
 * predicate.
 *
 * Mapping rules (in order of precedence):
 *
 *   isRunning == true                  → working   (overrides all below)
 *
 *   worktreeState         status       → dock status
 *   --------------------  -----------  -----------------------
 *   landed                *            landed
 *   discarded             *            discarded
 *   active                pending      working
 *   active                fixed        readyToLand
 *   active                deferred     awaitingClarification
 *   active                wontfix      discarded
 *   none                  fixed        readyToLand  *
 *   none                  wontfix      discarded
 *   none                  deferred     awaitingClarification
 *   none                  pending      pending
 *
 *   * "fixed without a worktree" can happen in inline-mode runs where
 *     the agent committed directly; treating it as readyToLand keeps the
 *     dock honest about what's left to act on.
 *
 *   `isRunning` (an SDK turn is in flight — tracked by the `active_runs`
 *   table) takes top precedence. An inline-mode agent runs with
 *   (status=pending, worktreeState=none), which otherwise maps to the
 *   terminal `pending` and never surfaces — so without this axis the
 *   widget's running-agents tray couldn't show a live inline run. A
 *   follow-up turn on an already-`fixed`/`deferred` row is likewise
 *   "working" while live. Defaults to false so callers that don't track
 *   run state (older servers, the two-axis storage shape) are unchanged.
 *
 *   `error` and `anchorLost` are out of band — the server doesn't track
 *   them, only the widget does (client-side), so they don't appear here.
 *
 * Lives in @pinagent/shared (not widget-dock) so both the dock and the
 * browser widget derive status the same way without one importing the
 * other.
 */
import type { StatusKey } from './dock-api';

export type ServerStatus = 'pending' | 'fixed' | 'wontfix' | 'deferred';
export type ServerWorktreeState = 'none' | 'active' | 'landed' | 'discarded';

export function deriveDockStatus(
  status: ServerStatus,
  worktreeState: ServerWorktreeState,
  isRunning = false,
): StatusKey {
  if (isRunning) return 'working';
  if (worktreeState === 'landed') return 'landed';
  if (worktreeState === 'discarded') return 'discarded';
  if (status === 'wontfix') return 'discarded';
  if (status === 'deferred') return 'awaitingClarification';
  if (status === 'fixed') return 'readyToLand';
  if (worktreeState === 'active') return 'working';
  return 'pending';
}

/**
 * Whether a derived status represents an agent the developer might still
 * want to act on — one mid-run, ready to land, or waiting on them. This
 * is the set the widget's running-agents tray surfaces; landed/discarded
 * (and the client-only error/anchorLost) are terminal or out of band.
 */
export function isUnresolvedStatus(status: StatusKey): boolean {
  return status === 'working' || status === 'readyToLand' || status === 'awaitingClarification';
}
