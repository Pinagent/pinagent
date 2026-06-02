// SPDX-License-Identifier: Apache-2.0
/**
 * Derive the dashboard's primary-action button from the working-copy git
 * state. Pure + leaf so it can be unit-tested without the router tree —
 * same pattern as `conversation-status.ts`.
 *
 * The state machine the user asked for:
 *   - on base branch, changes present    → Start a branch
 *   - no PR yet, changes present         → Create PR
 *   - PR open/draft, ahead or uncommitted → Push changes (commits, then pushes)
 *   - PR open/draft, up to date          → View PR
 *   - PR merged                          → View PR (terminal)
 *   - nothing to do                      → disabled
 */
import type { WorkingCopyStatus } from '@pinagent/shared';

export type WorkingCopyActionKind = 'create' | 'push' | 'view' | 'start' | 'disabled';

export interface WorkingCopyAction {
  kind: WorkingCopyActionKind;
  label: string;
  /** Present for the 'view' action — the PR URL to open. */
  href?: string;
  /** Short reason shown alongside a disabled button. */
  disabledReason?: string;
}

export function deriveWorkingCopyAction(status: WorkingCopyStatus): WorkingCopyAction {
  // Detached HEAD (e.g. a `git worktree add --detach`) has no branch to push
  // or PR — disable rather than offer a Create PR that errors on click.
  if (status.branch === 'HEAD') {
    return { kind: 'disabled', label: 'Create PR', disabledReason: 'Detached HEAD' };
  }

  // Can't open a PR from the base branch onto itself — offer to move the
  // changes onto a fresh feature branch instead (then Create PR applies).
  if (status.isDefaultBranch) {
    if (status.filesChanged > 0) {
      return { kind: 'start', label: 'Start a branch' };
    }
    return { kind: 'disabled', label: 'Create PR', disabledReason: `On ${status.baseBranch}` };
  }

  if (status.pr) {
    // A merged (or closed) PR is terminal here — surface the link, don't
    // offer push. Open/draft PRs flip between push (commits ahead) and view.
    if (status.pr.state === 'merged' || status.pr.state === 'closed') {
      return { kind: 'view', label: 'View PR', href: status.pr.url };
    }
    // Local commits not yet pushed, OR uncommitted edits (Push commits them
    // first) — either way there's new work to ship to the open PR.
    if (status.ahead > 0 || status.dirty) {
      return { kind: 'push', label: 'Push changes' };
    }
    return { kind: 'view', label: 'View PR', href: status.pr.url };
  }

  // No PR yet — offer to create one when there's something to compare.
  if (status.filesChanged > 0 || status.ahead > 0) {
    return { kind: 'create', label: 'Create PR' };
  }

  return { kind: 'disabled', label: 'Create PR', disabledReason: 'No changes' };
}
