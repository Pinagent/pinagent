// SPDX-License-Identifier: Apache-2.0
// Read-side worktree stats / diff / preview. Lifted out of agent.ts; these
// power the dock's Changes view and never touch the run loop, so they live
// apart from the SDK-heavy agent module.
import { existsSync } from 'node:fs';
import { runGitCapture } from './git-utils';

/**
 * Diff summary for a worktree vs a base ref. Used by the dock's Changes
 * view to render filesChanged / additions / deletions per conversation
 * without the dock having to learn git itself.
 *
 * `filesChanged` includes both committed and uncommitted changes (we
 * `git add -A` mentally — the worktree-state machine will commit them
 * during `mergeWorktree` anyway, so showing them as part of the diff
 * matches what `Land` will produce).
 *
 * Returns null when the worktree path doesn't exist or git fails. The
 * caller treats that as "unknown" and omits the row from the changes
 * list rather than showing zeroes.
 */
export interface WorktreeStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export async function computeWorktreeStats(
  worktreePath: string,
  baseRef: string,
): Promise<WorktreeStats | null> {
  if (!existsSync(worktreePath)) return null;
  // `--shortstat` gives us the one-line summary we want, e.g.
  //   " 3 files changed, 27 insertions(+), 9 deletions(-)"
  // Compare against the merge-base of baseRef so renames + cherry-picks
  // count once. Fall back to a plain diff against baseRef if merge-base
  // can't be computed (worktree was created off a branch that's since
  // been deleted, etc).
  const mb = await runGitCapture(worktreePath, ['merge-base', baseRef, 'HEAD']);
  const compareTo = mb.code === 0 ? mb.stdout.trim() : baseRef;
  // Include both committed (`HEAD..compareTo` semantics) and the working
  // tree by passing only `compareTo` — `git diff <ref>` diffs the
  // working tree against <ref>, picking up uncommitted edits too.
  const diff = await runGitCapture(worktreePath, ['diff', '--shortstat', compareTo]);
  if (diff.code !== 0) return null;
  const line = diff.stdout.trim();
  if (!line) return { filesChanged: 0, additions: 0, deletions: 0 };
  return parseShortStat(line);
}

/**
 * One-line preview of the first changed hunk for a worktree. Drives
 * the dock's Changes list row, which renders this as a truncated
 * monospace line under the stats. Returns '' for worktrees with no
 * changes (or only binary/rename-only diffs that don't have a
 * `+`/`-` content line to surface).
 */
const PREVIEW_MAX_CHARS = 140;
export async function computeWorktreePreview(
  worktreePath: string,
  baseRef: string,
): Promise<string> {
  if (!existsSync(worktreePath)) return '';
  const mb = await runGitCapture(worktreePath, ['merge-base', baseRef, 'HEAD']);
  const compareTo = mb.code === 0 ? mb.stdout.trim() : baseRef;
  // `--unified=0` strips context lines so the first content line we see
  // is an actual change. Capped via `--stat-count` equivalents — we don't
  // need the whole diff, just enough to find the first `+`/`-` line.
  // `git diff` doesn't have a head-style flag, so we rely on the early
  // return below to stop scanning once we have a hit.
  const result = await runGitCapture(worktreePath, [
    'diff',
    '--no-color',
    '--unified=0',
    compareTo,
  ]);
  if (result.code !== 0) return '';
  for (const line of result.stdout.split('\n')) {
    // Skip diff headers (--- a/x, +++ b/x) and metadata. Real content
    // lines are exactly one `+` or `-` followed by the source.
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (!line.startsWith('+') && !line.startsWith('-')) continue;
    const trimmed =
      line.length > PREVIEW_MAX_CHARS ? `${line.slice(0, PREVIEW_MAX_CHARS - 1)}…` : line;
    return trimmed;
  }
  return '';
}

export interface WorktreeDiff {
  /** Unified diff text. Possibly truncated — see `truncated`. */
  diff: string;
  /** True when the source diff exceeded the cap and `diff` was cut short. */
  truncated: boolean;
}

/**
 * Capture the full unified diff of a worktree against its base ref —
 * the data the Changes view's expand-to-diff UI renders. Capped at a
 * generous-but-bounded size so an accidental megabyte of churn doesn't
 * lock up the dock when the user expands a row.
 *
 * Mirrors `computeWorktreeStats`'s base-resolution shape so the diff
 * and the stats line up for any given conversation.
 */
const DIFF_CAP_BYTES = 512 * 1024;

export async function computeWorktreeDiff(
  worktreePath: string,
  baseRef: string,
): Promise<WorktreeDiff | null> {
  if (!existsSync(worktreePath)) return null;
  const mb = await runGitCapture(worktreePath, ['merge-base', baseRef, 'HEAD']);
  const compareTo = mb.code === 0 ? mb.stdout.trim() : baseRef;
  const result = await runGitCapture(worktreePath, ['diff', '--no-color', compareTo]);
  if (result.code !== 0) return null;
  if (result.stdout.length <= DIFF_CAP_BYTES) {
    return { diff: result.stdout, truncated: false };
  }
  // Truncate on a line boundary so the renderer never sees a half-hunk.
  const cut = result.stdout.lastIndexOf('\n', DIFF_CAP_BYTES);
  return {
    diff: result.stdout.slice(0, cut >= 0 ? cut : DIFF_CAP_BYTES),
    truncated: true,
  };
}

function parseShortStat(line: string): WorktreeStats {
  // Format: " N files changed, X insertions(+), Y deletions(-)"
  // Any of files/insertions/deletions can be missing if zero.
  const files = /(\d+)\s+files?\s+changed/.exec(line);
  const ins = /(\d+)\s+insertions?\(\+\)/.exec(line);
  const del = /(\d+)\s+deletions?\(-\)/.exec(line);
  return {
    filesChanged: files ? Number(files[1]) : 0,
    additions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  };
}

/**
 * Count files with uncommitted changes in a worktree (`git status --porcelain`
 * line count). Returns `null` if the worktree path doesn't exist or `git`
 * fails — the caller treats that as "unknown" rather than zero, so the widget
 * can omit the count from its label instead of showing a misleading "0 changes".
 */
export async function countWorktreeChanges(worktreePath: string): Promise<number | null> {
  if (!existsSync(worktreePath)) return null;
  const status = await runGitCapture(worktreePath, ['status', '--porcelain']);
  if (status.code !== 0) return null;
  const trimmed = status.stdout.trim();
  if (!trimmed) return 0;
  return trimmed.split('\n').length;
}
