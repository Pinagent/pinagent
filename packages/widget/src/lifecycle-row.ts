// SPDX-License-Identifier: Apache-2.0
import type { WorktreeWireState } from '@pinagent/shared';
import type { LifecycleEls } from './types';

/** What the lifecycle row (branch label + Land / Discard) renders from. */
export interface LifecycleRowState {
  feedbackId: string;
  worktreeState: WorktreeWireState;
  /** Uncommitted-file count, or null when unknown (label omits it). */
  worktreeChanges: number | null;
  /** Land/Discard are enabled only when no turn runs and no ask is open. */
  canAct: boolean;
}

function branchSummary(feedbackId: string, worktreeChanges: number | null): string {
  // Worktree branches are always named `pinagent/<feedbackId>` (see
  // `createWorktree` in agent-runner). Show the full branch in the label
  // so the dev can match it against `git branch` output.
  const branch = `pinagent/${feedbackId}`;
  if (worktreeChanges === null) return branch;
  const noun = worktreeChanges === 1 ? 'change' : 'changes';
  return `${branch} · ${worktreeChanges} ${noun}`;
}

/**
 * Render the stream pane's worktree lifecycle row. Pure DOM write from
 * `state` — idempotent, so the stream handler calls it after every worktree
 * broadcast and every turn transition. Split out of stream-handler.ts.
 */
export function renderLifecycleRow(
  lifecycle: LifecycleEls,
  state: LifecycleRowState,
  extra?: { commitSha?: string; message?: string },
): void {
  const { feedbackId, worktreeState, worktreeChanges, canAct } = state;
  const { row, label, landBtn, discardBtn } = lifecycle;
  const cls = row.classList;
  cls.remove('landed', 'discarded', 'conflict', 'busy');

  if (worktreeState === 'none') {
    row.hidden = true;
    return;
  }
  row.hidden = false;

  switch (worktreeState) {
    case 'active':
      label.textContent = canAct
        ? branchSummary(feedbackId, worktreeChanges)
        : `Working on ${branchSummary(feedbackId, worktreeChanges)}`;
      landBtn.hidden = false;
      discardBtn.hidden = false;
      landBtn.disabled = !canAct;
      discardBtn.disabled = !canAct;
      landBtn.textContent = 'Land';
      discardBtn.textContent = 'Discard';
      if (extra?.message) label.textContent = `Last attempt: ${extra.message}`;
      break;
    case 'landing':
      cls.add('busy');
      label.textContent = 'Landing…';
      landBtn.hidden = false;
      discardBtn.hidden = true;
      landBtn.disabled = true;
      landBtn.textContent = 'Landing…';
      break;
    case 'landed':
      cls.add('landed');
      label.textContent = extra?.commitSha ? `Landed · ${extra.commitSha.slice(0, 12)}` : 'Landed';
      landBtn.hidden = true;
      discardBtn.hidden = true;
      break;
    case 'discarding':
      cls.add('busy');
      label.textContent = 'Discarding…';
      landBtn.hidden = true;
      discardBtn.hidden = false;
      discardBtn.disabled = true;
      discardBtn.textContent = 'Discarding…';
      break;
    case 'discarded':
      cls.add('discarded');
      label.textContent = 'Discarded';
      landBtn.hidden = true;
      discardBtn.hidden = true;
      break;
    case 'conflict':
      cls.add('conflict');
      label.textContent = 'Merge conflict — resolve in editor, then retry';
      landBtn.hidden = false;
      discardBtn.hidden = false;
      landBtn.disabled = !canAct;
      discardBtn.disabled = !canAct;
      landBtn.textContent = 'Retry land';
      discardBtn.textContent = 'Discard';
      break;
    case 'ttl_warning':
      label.textContent = `Old worktree · ${branchSummary(feedbackId, worktreeChanges)} — review or discard`;
      landBtn.hidden = false;
      discardBtn.hidden = false;
      landBtn.disabled = !canAct;
      discardBtn.disabled = !canAct;
      landBtn.textContent = 'Land';
      discardBtn.textContent = 'Discard';
      break;
  }
}
