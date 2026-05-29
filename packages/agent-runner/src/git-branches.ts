// SPDX-License-Identifier: Apache-2.0
/**
 * List the repo's real git branches — base-branch candidates for the PR
 * composer. Distinct from `branches.ts`, which lists pinagent's own
 * *worktree* branches (one per conversation); this is the project's
 * actual heads + origin remotes, normalized into a flat name list.
 *
 * The composer's base-branch field stays free-text (you can target a
 * branch git doesn't know about yet); this just feeds the dropdown so
 * the common case is a pick, not a type.
 */
import { runGitCapture } from './git-utils';

/**
 * Normalize `git for-each-ref --format=%(refname:short)` output over
 * `refs/heads refs/remotes/origin`: strip the `origin/` prefix off
 * remote branches, drop the `origin/HEAD` symref, dedupe local vs remote
 * copies of the same branch, and sort. Pure so it's unit-testable
 * without a git repo.
 */
export function parseGitBranches(stdout: string): string[] {
  const out = new Set<string>();
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const name = line.startsWith('origin/') ? line.slice('origin/'.length) : line;
    if (!name || name === 'HEAD') continue;
    out.add(name);
  }
  return [...out].sort();
}

/**
 * Local heads + origin remotes for `projectRoot`, as a flat, sorted,
 * de-duplicated name list. Returns `[]` when the git call fails (not a
 * repo, no branches) — the composer falls back to plain free-text.
 */
export async function listGitBranches(projectRoot: string): Promise<string[]> {
  const result = await runGitCapture(projectRoot, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads',
    'refs/remotes/origin',
  ]);
  if (result.code !== 0) return [];
  return parseGitBranches(result.stdout);
}
