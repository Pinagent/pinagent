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
import { computeWorktreeDiff, computeWorktreeStats, type WorktreeDiff } from './agent';
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
      const stats =
        rec.worktreeState === 'landed'
          ? // Landed worktrees may be gone from disk; their diff lives
            // in the commit history but we don't surface it on the
            // Changes view — landed rows are read-only history here.
            { filesChanged: 0, additions: 0, deletions: 0 }
          : await computeWorktreeStats(rec.worktreePath, baseRef);
      if (!stats) return null;
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
): Promise<WorktreeDiff | null> {
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
  return computeWorktreeDiff(rec.worktreePath, baseRef);
}
