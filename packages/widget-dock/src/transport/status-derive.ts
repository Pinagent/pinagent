// SPDX-License-Identifier: Apache-2.0
/**
 * Map the server's two-axis (status, worktreeState) representation into
 * the dock's single-axis status enum. The server's storage shape is
 * older than the dock's vocabulary — they overlap but don't match 1:1,
 * and the dock needs the single-axis form for badge color + filtering.
 *
 * Mapping rules (in order of precedence):
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
 *   `error` and `anchorLost` are out of band — the server doesn't track
 *   them, only the widget does (client-side), so they don't appear here.
 */
import type { StatusKey } from '@pinagent/ui/tokens';

type ServerStatus = 'pending' | 'fixed' | 'wontfix' | 'deferred';
type ServerWorktreeState = 'none' | 'active' | 'landed' | 'discarded';

export function deriveDockStatus(
  status: ServerStatus,
  worktreeState: ServerWorktreeState,
): StatusKey {
  if (worktreeState === 'landed') return 'landed';
  if (worktreeState === 'discarded') return 'discarded';
  if (status === 'wontfix') return 'discarded';
  if (status === 'deferred') return 'awaitingClarification';
  if (status === 'fixed') return 'readyToLand';
  if (worktreeState === 'active') return 'working';
  return 'pending';
}
