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
import { isInsideWorkTree, isWorkingTreeDirty, runGitCapture } from './git-utils';
import { type GitHubPrResult, openPrOnGitHub, pushBranch } from './github-pr';
import {
  type ScreenshotCandidate,
  selectBranchScreenshots,
  stageScreenshotAssets,
} from './pr-screenshots';
import { SettingsStore } from './settings-store';

const BRANCH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,127}$/;

export interface CommitResult {
  ok: boolean;
  /** True when a commit was actually made; false when the tree was clean. */
  committed: boolean;
  error?: string;
}

/**
 * Stage everything (`git add -A`) and commit with `message`. No-op (ok,
 * committed: false) when the tree is clean. SDK-free, so the dashboard's
 * Create PR / Push flows (and the MCP tool) can fold the developer's
 * uncommitted edits into the branch before pushing — otherwise the push
 * would silently omit them.
 */
export async function commitWorkingChanges(
  projectRoot: string,
  message: string,
): Promise<CommitResult> {
  if (!(await isWorkingTreeDirty(projectRoot))) return { ok: true, committed: false };
  const add = await runGitCapture(projectRoot, ['add', '-A']);
  if (add.code !== 0) {
    return { ok: false, committed: false, error: `git add failed: ${add.stderr.trim()}` };
  }
  // `git add -A` records any nested git repo (linked worktrees under
  // `.claude/worktrees`, vendored repos, an un-init'd submodule) as a
  // gitlink/"Subproject commit" — never what "commit my changes" means, and
  // it spammed a PR with dozens of `.claude/worktrees/*` subproject entries.
  // Unstage every newly-added gitlink before committing.
  await unstageAddedGitlinks(projectRoot);
  const commit = await runGitCapture(projectRoot, ['commit', '-m', message]);
  // After dropping the gitlinks there may be nothing real left to commit
  // (the only "changes" were embedded repos) — that's a clean no-op, not an
  // error.
  const nothingToCommit = /nothing to commit/.test(`${commit.stdout}\n${commit.stderr}`);
  if (commit.code !== 0 && !nothingToCommit) {
    return {
      ok: false,
      committed: false,
      error: `git commit failed: ${commit.stderr.trim() || commit.stdout.trim()}`,
    };
  }
  return { ok: true, committed: commit.code === 0 };
}

/**
 * Unstage entries that `git add -A` recorded as gitlinks (mode 160000) —
 * embedded git repositories it picked up. Only newly-added ones (status A),
 * so an intentionally-tracked submodule's pointer update is left alone.
 */
async function unstageAddedGitlinks(projectRoot: string): Promise<void> {
  const raw = await runGitCapture(projectRoot, ['diff', '--cached', '--raw']);
  if (raw.code !== 0) return;
  for (const line of raw.stdout.split('\n')) {
    if (!line.startsWith(':')) continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    // ":<oldmode> <newmode> <oldsha> <newsha> <status>" before the tab.
    const fields = line.slice(1, tab).split(' ');
    const newMode = fields[1];
    const status = fields[4] ?? '';
    const path = line.slice(tab + 1);
    if (newMode === '160000' && status.startsWith('A') && path) {
      await runGitCapture(projectRoot, ['reset', '-q', '--', path]);
    }
  }
}

async function resolveCurrentBranch(projectRoot: string): Promise<string | null> {
  const sym = await runGitCapture(projectRoot, ['symbolic-ref', '--short', 'HEAD']);
  if (sym.code !== 0) return null;
  const branch = sym.stdout.trim();
  return branch.length > 0 ? branch : null;
}

export interface OpenHostBranchPrOpts {
  title: string;
  body: string;
  /**
   * Commit message for any uncommitted working changes, committed (git add
   * -A) before the push so they land in the PR. Required when the tree is
   * dirty; ignored when clean.
   */
  commitMessage?: string;
  /**
   * Resolved-feedback records whose screenshots may belong to this branch.
   * The host branch carries no explicit conversation list, so any candidate
   * whose resolution `commitSha` lands in `<base>..HEAD` gets its screenshot
   * committed onto the branch and embedded in the PR body. Best-effort: only
   * feedback resolved with a recorded commit sha is matched. Omit to skip.
   */
  screenshotCandidates?: ScreenshotCandidate[];
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

  // Fold uncommitted working changes into the branch so the PR contains
  // them (the dock surfaces uncommitted edits; a bare push would omit them).
  if (await isWorkingTreeDirty(projectRoot)) {
    if (!opts.commitMessage) {
      return {
        ok: false,
        branchPushed: false,
        error: 'uncommitted changes present — provide a commit message',
      };
    }
    const committed = await commitWorkingChanges(projectRoot, opts.commitMessage);
    if (!committed.ok) {
      return { ok: false, branchPushed: false, error: committed.error };
    }
  }

  // Attach screenshots of any feedback resolved on this branch: commit the
  // PNGs onto the branch (before the push below carries them to the remote)
  // and fold a markdown block of their blob URLs into the PR body.
  const shots = await selectBranchScreenshots(
    projectRoot,
    baseBranch,
    opts.screenshotCandidates ?? [],
  );
  const { markdown: screenshotMd } = await stageScreenshotAssets(
    projectRoot,
    projectRoot,
    branch,
    shots,
  );

  const push = await pushBranch(projectRoot, branch);
  if (!push.ok) {
    return { ok: false, branchPushed: false, error: push.error ?? 'git push failed' };
  }

  return openPrOnGitHub(projectRoot, {
    branchName: branch,
    baseBranch,
    title: opts.title,
    body: opts.body + screenshotMd,
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
export async function pushHostBranch(
  projectRoot: string,
  opts: { commitMessage?: string } = {},
): Promise<PushHostBranchResult> {
  if (!(await isInsideWorkTree(projectRoot))) {
    return { ok: false, pushed: false, error: 'project root is not a git repository' };
  }
  const branch = await resolveCurrentBranch(projectRoot);
  if (!branch) {
    return { ok: false, pushed: false, error: 'cannot push a detached HEAD' };
  }
  // Commit uncommitted edits first so "Push changes" ships everything the
  // dashboard shows, not just already-committed work.
  if (await isWorkingTreeDirty(projectRoot)) {
    if (!opts.commitMessage) {
      return {
        ok: false,
        pushed: false,
        error: 'uncommitted changes present — provide a commit message',
      };
    }
    const committed = await commitWorkingChanges(projectRoot, opts.commitMessage);
    if (!committed.ok) {
      return { ok: false, pushed: false, error: committed.error };
    }
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
  let name = opts.name?.trim() || `pinagent/${nanoid(8)}`;
  if (!BRANCH_NAME_RE.test(name)) {
    return { ok: false, error: 'invalid branch name (alphanumeric + ./_- only)' };
  }
  // Derived slugs can repeat across similar changes — suffix to dodge a
  // collision rather than failing the action.
  if (await branchExists(projectRoot, name)) {
    name = `${name}-${nanoid(4)}`;
  }
  // `git switch -c` keeps uncommitted changes in the working tree and moves
  // them onto the new branch; the base branch stays at its current commit.
  const res = await runGitCapture(projectRoot, ['switch', '-c', name]);
  if (res.code !== 0) {
    return { ok: false, error: `git switch failed: ${res.stderr.trim() || res.stdout.trim()}` };
  }
  return { ok: true, branch: name };
}

async function branchExists(projectRoot: string, name: string): Promise<boolean> {
  const res = await runGitCapture(projectRoot, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${name}`,
  ]);
  return res.code === 0;
}

/**
 * Turn a change summary (e.g. an agent-written commit subject like
 * `feat(dock): add pricing tiers`) into a readable branch name —
 * `pinagent/add-pricing-tiers`. Drops any Conventional-Commits prefix,
 * lowercases, and dash-joins. Returns undefined when nothing usable remains
 * (caller then falls back to the auto-generated id).
 */
export function slugifyBranchName(summary: string): string | undefined {
  const withoutPrefix = summary.replace(/^\s*[a-z]+(\([^)]*\))?!?:\s*/i, '');
  const firstLine = (withoutPrefix.split('\n')[0] ?? '').trim();
  const slug = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug ? `pinagent/${slug}` : undefined;
}

// Re-exported through the SDK-free `@pinagent/agent-runner/pr` entry so the
// `@pinagent/mcp` bin can build screenshot candidates for `create_pull_request`.
export { type ScreenshotCandidate, toScreenshotCandidates } from './pr-screenshots';
