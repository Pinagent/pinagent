// SPDX-License-Identifier: Apache-2.0
/**
 * `listChanges` — assemble the data the dock's Changes view needs.
 *
 * Walks every conversation with a worktree (`worktreeState` in
 * 'active' | 'landed'), computes its diff stats against the project's
 * current HEAD branch, and returns a flat array shaped for the dock's
 * existing Change row layout.
 *
 * Lives in agent-runner (not in middleware.ts / route.ts) so both the
 * vite-plugin and next-plugin call into the same logic — they only
 * differ in how the returned data is serialized to the wire.
 */
import {
  computeWorktreeDiff,
  computeWorktreePreview,
  computeWorktreeStats,
  type WorktreeDiff,
} from './agent';
import { runGitCapture } from './git-utils';
import { Storage } from './storage';

export interface ChangeRecord {
  id: string;
  conversationId: string;
  conversationTitle: string;
  /**
   * One of: 'pending' (worktree exists, agent hasn't produced commits
   * yet — filesChanged may still be 0), 'readyToLand' (worktree has
   * changes ahead of base), 'landed' (worktree was merged), 'error'
   * (worktree was discarded with an error).
   */
  status: 'pending' | 'readyToLand' | 'landed' | 'error';
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  /**
   * True when the worktree's branch has commits ahead of the project
   * HEAD branch — which today only happens if a human reached into the
   * worktree and committed manually, since the agent intentionally
   * leaves changes uncommitted (see `buildInitialPrompt` in agent.ts).
   *
   * The dock surfaces this as a "modified externally" warning on the
   * row so the user knows their manual edits exist outside the
   * conversation's record before they Land or Discard.
   */
  externallyModified: boolean;
  /**
   * One-line diff preview for the row — the first `+`/`-` line from
   * the worktree's diff against base, truncated. Empty when the
   * worktree has no changes, has only renames/binary diffs, or is a
   * landed worktree (gone from disk). Drives the truncated monospace
   * line under the stats on the Changes view.
   */
  preview: string;
  updatedAt: string;
}

/**
 * Best-effort resolution of the project's current HEAD branch — used
 * as the diff base. Falls back to the literal string `HEAD` if `git
 * symbolic-ref` fails (detached HEAD, no .git at root), which still
 * gives a usable diff.
 */
async function resolveBaseRef(projectRoot: string): Promise<string> {
  const sym = await runGitCapture(projectRoot, ['symbolic-ref', '--short', 'HEAD']);
  if (sym.code === 0) return sym.stdout.trim();
  return 'HEAD';
}

/**
 * Count commits on the worktree's branch that aren't on the base. The
 * agent never commits (the Land step does it on the user's behalf, see
 * agent.ts `mergeWorktree`), so any commit here came from the user
 * reaching into the worktree manually. Returns 0 on git failures —
 * the warning is best-effort, never worth blocking the Changes view.
 */
async function countExternalCommits(worktreePath: string, baseRef: string): Promise<number> {
  const ahead = await runGitCapture(worktreePath, ['rev-list', '--count', `${baseRef}..HEAD`]);
  if (ahead.code !== 0) return 0;
  const n = Number(ahead.stdout.trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function listChanges(projectRoot: string): Promise<ChangeRecord[]> {
  const storage = new Storage(projectRoot);
  const all = await storage.list();
  const candidates = all.filter(
    (r) => r.worktreeState === 'active' || r.worktreeState === 'landed',
  );
  if (candidates.length === 0) return [];

  const baseRef = await resolveBaseRef(projectRoot);
  // Run the per-row stats in parallel — each is independent git work
  // bounded by I/O. Bound concurrency only if we see many rows; for
  // typical projects (<100 active conversations) the parallel cost is
  // fine and matters less than the round-trip latency to the dock.
  const rows = await Promise.all(
    candidates.map(async (rec): Promise<ChangeRecord | null> => {
      if (!rec.worktreePath) return null;
      const isActive = rec.worktreeState === 'active';
      const stats = isActive
        ? await computeWorktreeStats(rec.worktreePath, baseRef)
        : // Landed worktrees may be gone from disk; their diff lives
          // in the commit history but we don't surface it on the
          // Changes view — landed rows are read-only history here.
          { filesChanged: 0, additions: 0, deletions: 0 };
      if (!stats) return null;
      // External-commit check only applies to active worktrees —
      // landed/discarded worktrees are gone from disk and any divergence
      // was resolved at land/discard time.
      const externallyModified = isActive
        ? (await countExternalCommits(rec.worktreePath, baseRef)) > 0
        : false;
      // Preview comes from the same `git diff` family of calls the
      // stats use, so this only matters for active worktrees — landed
      // ones don't have an inspectable on-disk diff anymore.
      const preview = isActive ? await computeWorktreePreview(rec.worktreePath, baseRef) : '';
      return {
        id: rec.id,
        conversationId: rec.id,
        conversationTitle: titleOf(rec.comment),
        status:
          rec.worktreeState === 'landed'
            ? 'landed'
            : stats.filesChanged > 0
              ? 'readyToLand'
              : 'pending',
        branch: rec.branch ?? '',
        filesChanged: stats.filesChanged,
        additions: stats.additions,
        deletions: stats.deletions,
        externallyModified,
        preview,
        updatedAt: rec.updatedAt,
      };
    }),
  );
  return rows
    .filter((r): r is ChangeRecord => r !== null)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function titleOf(comment: string): string {
  const first = comment.split('\n').find((l) => l.trim().length > 0) ?? comment;
  const t = first.trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/**
 * Fetch the full unified diff for one conversation's worktree. Returns
 * null when the conversation isn't found, isn't in a worktree state we
 * can diff, or the worktree is gone from disk.
 *
 * PR-D3 lazy-loads diffs per row via this — the list endpoint stays
 * lightweight (stats only), only expanded rows pay the diff cost.
 */
export async function getChangeDiff(
  projectRoot: string,
  feedbackId: string,
): Promise<(WorktreeDiff & { worktreePath: string }) | null> {
  const storage = new Storage(projectRoot);
  const rec = await storage.read(feedbackId);
  if (!rec) return null;
  // Landed worktrees may be gone from disk — the diff lives in the
  // merge commit but we don't surface that here (Changes view treats
  // landed rows as history, no diff body). Only active worktrees have
  // an inspectable diff.
  if (rec.worktreeState !== 'active') return null;
  if (!rec.worktreePath) return null;
  const baseRef = await resolveBaseRef(projectRoot);
  const diff = await computeWorktreeDiff(rec.worktreePath, baseRef);
  if (!diff) return null;
  // Surface the worktree's absolute path so the dock can open changed
  // files at the agent's edited version (the workspace still holds the
  // old copy until the change lands).
  return { ...diff, worktreePath: rec.worktreePath };
}
