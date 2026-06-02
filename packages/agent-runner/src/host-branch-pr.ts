// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-centric PR actions for the dock dashboard — push / open a PR for
 * the branch the dev-server is *already on*, rather than merging a set of
 * per-conversation worktrees (that's `pr-composer.ts`).
 *
 * The PR title/body are supplied by the caller: the dock endpoint runs the
 * inline summarizer (`summarize-changes.ts`) first; the `@pinagent/mcp`
 * `create_pull_request` tool has the connected agent summarize and pass
 * them in. Both then land here.
 *
 * Imports only git + `github-pr` (Octokit) — NOT the Claude Agent SDK — so
 * the MCP binary can import `openHostBranchPr` without bundling the SDK.
 */
import { nanoid } from 'nanoid';
import { isInsideWorkTree, runGitCapture } from './git-utils';
import { type GitHubPrResult, openPrOnGitHub, pushBranch } from './github-pr';
import { SettingsStore } from './settings-store';

const BRANCH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,127}$/;

async function resolveCurrentBranch(projectRoot: string): Promise<string | null> {
  const sym = await runGitCapture(projectRoot, ['symbolic-ref', '--short', 'HEAD']);
  if (sym.code !== 0) return null;
  const branch = sym.stdout.trim();
  return branch.length > 0 ? branch : null;
}

export interface OpenHostBranchPrOpts {
  title: string;
  body: string;
}

/**
 * Push the current branch and open a PR targeting the configured base
 * branch. Guards against PR-ing the base branch onto itself (nothing to
 * compare) and detached HEAD.
 */
export async function openHostBranchPr(
  projectRoot: string,
  opts: OpenHostBranchPrOpts,
): Promise<GitHubPrResult> {
  if (!(await isInsideWorkTree(projectRoot))) {
    return { ok: false, branchPushed: false, error: 'project root is not a git repository' };
  }
  const branch = await resolveCurrentBranch(projectRoot);
  if (!branch) {
    return { ok: false, branchPushed: false, error: 'cannot open a PR from a detached HEAD' };
  }
  const { baseBranch } = await new SettingsStore(projectRoot).read();
  if (branch === baseBranch) {
    return {
      ok: false,
      branchPushed: false,
      error: `current branch "${branch}" is the base branch — switch to a feature branch first`,
    };
  }

  const push = await pushBranch(projectRoot, branch);
  if (!push.ok) {
    return { ok: false, branchPushed: false, error: push.error ?? 'git push failed' };
  }

  return openPrOnGitHub(projectRoot, {
    branchName: branch,
    baseBranch,
    title: opts.title,
    body: opts.body,
    conversationIds: [],
  });
}

export interface PushHostBranchResult {
  ok: boolean;
  pushed: boolean;
  error?: string;
}

/**
 * Push the current branch to its upstream — backs the dashboard's "Push
 * changes" action when local commits are ahead of the remote (e.g. agents
 * landed more work after the PR was opened).
 */
export async function pushHostBranch(projectRoot: string): Promise<PushHostBranchResult> {
  if (!(await isInsideWorkTree(projectRoot))) {
    return { ok: false, pushed: false, error: 'project root is not a git repository' };
  }
  const branch = await resolveCurrentBranch(projectRoot);
  if (!branch) {
    return { ok: false, pushed: false, error: 'cannot push a detached HEAD' };
  }
  const push = await pushBranch(projectRoot, branch);
  if (!push.ok) {
    return { ok: false, pushed: false, error: push.error };
  }
  return { ok: true, pushed: true };
}

export interface StartHostBranchResult {
  ok: boolean;
  /** The branch that was created + switched to. */
  branch?: string;
  error?: string;
}

/**
 * Create a new branch from the current HEAD and switch to it, carrying any
 * uncommitted working changes over (leaving the base branch clean). Backs
 * the dashboard's "Start a branch" action — the helpful next step when the
 * dev server is on the base branch, where a PR can't be opened (main→main).
 * The auto-generated `pinagent/<id>` name is fine; the eventual Create PR
 * supplies the real, agent-summarized title.
 */
export async function startHostBranch(
  projectRoot: string,
  opts: { name?: string } = {},
): Promise<StartHostBranchResult> {
  if (!(await isInsideWorkTree(projectRoot))) {
    return { ok: false, error: 'project root is not a git repository' };
  }
  const name = opts.name?.trim() || `pinagent/${nanoid(8)}`;
  if (!BRANCH_NAME_RE.test(name)) {
    return { ok: false, error: 'invalid branch name (alphanumeric + ./_- only)' };
  }
  // `git switch -c` keeps uncommitted changes in the working tree and moves
  // them onto the new branch; the base branch stays at its current commit.
  const res = await runGitCapture(projectRoot, ['switch', '-c', name]);
  if (res.code !== 0) {
    return { ok: false, error: `git switch failed: ${res.stderr.trim() || res.stdout.trim()}` };
  }
  return { ok: true, branch: name };
}
