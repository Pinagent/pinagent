// SPDX-License-Identifier: Apache-2.0
// Worktree lifecycle: create / land (merge) / discard / reopen. Lifted out
// of agent.ts; these operate on git worktrees + the storage record and never
// call the run loop, so they live apart from the SDK-heavy agent module.
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { recordAuditEvent } from './audit-log';
import { appendLog, runGit, runGitCapture } from './git-utils';
import { type FeedbackRecord, Storage } from './storage';

export async function createWorktree(
  projectRoot: string,
  feedbackId: string,
  logPath: string,
): Promise<string> {
  if (!existsSync(join(projectRoot, '.git'))) {
    throw new Error('project root is not a git repository');
  }

  const worktreeDir = join(projectRoot, '.pinagent', 'worktrees');
  await mkdir(worktreeDir, { recursive: true });
  const worktreePath = join(worktreeDir, feedbackId);
  const branch = `pinagent/${feedbackId}`;

  await runGit(projectRoot, ['worktree', 'add', '-b', branch, worktreePath], logPath);

  // Persist so the widget can read `worktreeState='active'` and surface
  // Land/Discard controls without polling the filesystem, and so a TTL
  // sweep on next startup can find this row.
  try {
    const storage = new Storage(projectRoot);
    await storage.patch(feedbackId, {
      branch,
      worktreePath,
      worktreeState: 'active',
    });
  } catch {
    // Best-effort. The worktree is real on disk regardless; the widget
    // can recover state from the next reload via the full record.
  }

  return worktreePath;
}

export interface LandResult {
  ok: boolean;
  /** Merge commit sha on success. */
  commitSha?: string;
  /** Conflicted files when `ok` is false because of a merge conflict. */
  conflicts?: string[];
  /** Human-readable failure reason when `ok` is false for any other cause. */
  error?: string;
}

/**
 * Land the agent's worktree onto the project's current HEAD branch.
 *
 * The agent intentionally does not commit (see `buildInitialPrompt`) so the
 * developer can review the diff before landing; we stage and commit on its
 * behalf as a single squash here. On merge conflict the merge is aborted —
 * the worktree is left intact so the user can resolve manually and retry.
 *
 * Should be called via `merge-queue.ts` so concurrent landings on the same
 * project serialize cleanly.
 */
export async function mergeWorktree(
  projectRoot: string,
  feedbackId: string,
  logPath: string,
): Promise<LandResult> {
  const storage = new Storage(projectRoot);
  const rec = await storage.read(feedbackId);
  if (!rec) return { ok: false, error: `feedback not found: ${feedbackId}` };
  if (!rec.worktreePath || !rec.branch) {
    return {
      ok: false,
      error: 'this conversation has no worktree (inline-mode submission)',
    };
  }
  if (rec.worktreeState !== 'active') {
    return { ok: false, error: `cannot land: worktree state is ${rec.worktreeState}` };
  }
  if (!existsSync(rec.worktreePath)) {
    return { ok: false, error: `worktree no longer exists at ${rec.worktreePath}` };
  }
  if (!existsSync(join(projectRoot, '.git'))) {
    return { ok: false, error: 'project root is not a git repository' };
  }

  await appendLog(logPath, `\n## Land · ${new Date().toISOString()}\n\n`);

  const head = await runGitCapture(projectRoot, ['symbolic-ref', '--short', 'HEAD']);
  if (head.code !== 0) {
    return {
      ok: false,
      error: `cannot resolve project HEAD branch (detached?): ${head.stderr.trim()}`,
    };
  }
  const targetBranch = head.stdout.trim();
  if (targetBranch === rec.branch) {
    return { ok: false, error: `project HEAD is already on ${rec.branch}; nothing to land` };
  }

  // Commit any uncommitted edits on the worktree's branch. The agent
  // leaves work uncommitted by design; landing = "accept these changes".
  const status = await runGitCapture(rec.worktreePath, ['status', '--porcelain']);
  if (status.code !== 0) {
    return { ok: false, error: `git status failed in worktree: ${status.stderr.trim()}` };
  }
  if (status.stdout.trim()) {
    const add = await runGitCapture(rec.worktreePath, ['add', '-A']);
    if (add.code !== 0) {
      return { ok: false, error: `git add failed: ${add.stderr.trim()}` };
    }
    const commit = await runGitCapture(rec.worktreePath, [
      'commit',
      '-m',
      formatLandCommitMessage(rec),
    ]);
    if (commit.code !== 0) {
      const combined = `${commit.stdout}\n${commit.stderr}`;
      if (!/nothing to commit/.test(combined)) {
        return {
          ok: false,
          error: `git commit failed: ${commit.stderr.trim() || commit.stdout.trim()}`,
        };
      }
    }
  }

  // No-op if the branch has nothing diverging from target (agent made
  // no changes). Still treat as landed so the UI clears the controls.
  const ahead = await runGitCapture(projectRoot, [
    'rev-list',
    '--count',
    `${targetBranch}..${rec.branch}`,
  ]);
  if (ahead.code !== 0) {
    return { ok: false, error: `cannot compare branches: ${ahead.stderr.trim()}` };
  }
  if (Number(ahead.stdout.trim()) === 0) {
    await appendLog(logPath, '> [pinagent] no changes to land\n');
    await cleanupWorktreeFiles(rec.worktreePath, rec.branch, projectRoot, logPath);
    await storage.patch(feedbackId, { worktreeState: 'landed' });
    await recordAuditEvent(projectRoot, {
      conversationId: feedbackId,
      actor: 'user',
      action: 'conversation_landed',
      payload: { branch: rec.branch, target: targetBranch, noop: true },
    });
    return { ok: true };
  }

  const merge = await runGitCapture(projectRoot, ['merge', '--no-ff', '--no-edit', rec.branch]);
  if (merge.code !== 0) {
    const conflicted = await runGitCapture(projectRoot, ['diff', '--name-only', '--diff-filter=U']);
    const conflicts = conflicted.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    await runGitCapture(projectRoot, ['merge', '--abort']);
    await appendLog(
      logPath,
      `> [pinagent] merge into \`${targetBranch}\` failed: ${conflicts.length} conflicted file(s)\n${conflicts.map((c) => `>   - \`${c}\`\n`).join('')}\n`,
    );
    return { ok: false, conflicts };
  }

  const sha = await runGitCapture(projectRoot, ['rev-parse', 'HEAD']);
  const commitSha = sha.code === 0 ? sha.stdout.trim() : undefined;

  await cleanupWorktreeFiles(rec.worktreePath, rec.branch, projectRoot, logPath);
  await storage.patch(feedbackId, {
    worktreeState: 'landed',
    ...(commitSha ? { commitSha } : {}),
  });
  await recordAuditEvent(projectRoot, {
    conversationId: feedbackId,
    actor: 'user',
    action: 'conversation_landed',
    payload: {
      branch: rec.branch,
      target: targetBranch,
      ...(commitSha ? { commitSha } : {}),
    },
  });

  await appendLog(
    logPath,
    `> [pinagent] landed onto \`${targetBranch}\`${commitSha ? ` as \`${commitSha.slice(0, 12)}\`` : ''}\n`,
  );

  return { ok: true, ...(commitSha ? { commitSha } : {}) };
}

/**
 * Reverse a landed/discarded conversation: put it back in the active
 * list so the user can follow up with the agent. We reset
 * `worktreeState` to `'none'` and `status` to `'pending'`; we do NOT
 * recreate the worktree (it was cleaned up at land/discard time and
 * the developer's actual changes have either already merged or were
 * thrown away). For inline-mode runs that's all that's needed — the
 * user can immediately send a follow-up. For ex-worktree runs the
 * conversation is conceptually inline-mode from this point forward.
 *
 * Refuses on conversations that aren't already resolved so a stray
 * client click can't reset a still-active worktree.
 */
export async function reopenConversation(
  projectRoot: string,
  feedbackId: string,
  logPath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const storage = new Storage(projectRoot);
  const rec = await storage.read(feedbackId);
  if (!rec) return { ok: false, error: `feedback not found: ${feedbackId}` };
  if (rec.worktreeState !== 'landed' && rec.worktreeState !== 'discarded') {
    return {
      ok: false,
      error: `cannot reopen: worktree state is ${rec.worktreeState} (expected landed or discarded)`,
    };
  }

  await appendLog(logPath, `\n## Reopen · ${new Date().toISOString()}\n\n`);
  await storage.patch(feedbackId, { worktreeState: 'none', status: 'pending' });
  await recordAuditEvent(projectRoot, {
    conversationId: feedbackId,
    actor: 'user',
    action: 'conversation_reopened',
    payload: {
      previousWorktreeState: rec.worktreeState,
      previousStatus: rec.status,
    },
  });
  return { ok: true };
}

export interface BulkReopenResult {
  /** Conversation ids that flipped back to pending/none. */
  reopened: string[];
  /** Ids the storage layer couldn't reopen (not landed/discarded, missing, etc). */
  failed: { feedbackId: string; error: string }[];
}

/**
 * Bulk re-open a batch of resolved conversations from the History
 * view's multi-select. Each id goes through the existing per-row
 * `reopenConversation` so the worktree-state flip + per-row
 * `conversation_reopened` audit emission stay intact; this function
 * adds ONE summary `conversations_bulk_reopened` event covering the
 * batch.
 */
export async function reopenConversations(
  projectRoot: string,
  feedbackIds: string[],
): Promise<BulkReopenResult> {
  const reopened: string[] = [];
  const failed: { feedbackId: string; error: string }[] = [];

  for (const id of feedbackIds) {
    const logPath = join(projectRoot, '.pinagent', 'logs', `${id}.md`);
    await mkdir(join(projectRoot, '.pinagent', 'logs'), { recursive: true });
    try {
      const result = await reopenConversation(projectRoot, id, logPath);
      if (result.ok) reopened.push(id);
      else failed.push({ feedbackId: id, error: result.error });
    } catch (e) {
      failed.push({ feedbackId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (reopened.length > 0) {
    await recordAuditEvent(projectRoot, {
      conversationId: null,
      actor: 'user',
      action: 'conversations_bulk_reopened',
      payload: { ids: reopened, count: reopened.length },
    });
  }

  return { reopened, failed };
}

/**
 * Throw away the worktree and its branch without merging. Idempotent —
 * tolerates a missing worktree or branch (the user may have cleaned
 * them up manually).
 */
export async function discardWorktree(
  projectRoot: string,
  feedbackId: string,
  logPath: string,
): Promise<{ ok: true }> {
  const storage = new Storage(projectRoot);
  const rec = await storage.read(feedbackId);
  if (!rec) return { ok: true };

  await appendLog(logPath, `\n## Discard · ${new Date().toISOString()}\n\n`);

  if (rec.worktreePath && rec.branch) {
    await cleanupWorktreeFiles(rec.worktreePath, rec.branch, projectRoot, logPath);
  }
  await storage.patch(feedbackId, { worktreeState: 'discarded' });
  await recordAuditEvent(projectRoot, {
    conversationId: feedbackId,
    actor: 'user',
    action: 'conversation_discarded',
    payload: rec.branch ? { branch: rec.branch } : {},
  });
  return { ok: true };
}

async function cleanupWorktreeFiles(
  worktreePath: string,
  branch: string,
  projectRoot: string,
  logPath: string,
): Promise<void> {
  if (existsSync(worktreePath)) {
    const rm = await runGitCapture(projectRoot, ['worktree', 'remove', '--force', worktreePath]);
    if (rm.code !== 0) {
      await appendLog(
        logPath,
        `> [pinagent:git] worktree remove → exit ${rm.code}\n${rm.stderr}\n`,
      );
    }
  }
  // Even if `worktree remove` succeeded, prune so `git worktree list`
  // doesn't show stale entries when the directory was already gone.
  await runGitCapture(projectRoot, ['worktree', 'prune']);

  const br = await runGitCapture(projectRoot, ['branch', '-D', branch]);
  if (br.code !== 0 && !/not found|did not match/i.test(br.stderr)) {
    await appendLog(
      logPath,
      `> [pinagent:git] branch -D ${branch} → exit ${br.code}\n${br.stderr}\n`,
    );
  }
}

function formatLandCommitMessage(rec: FeedbackRecord): string {
  const firstLine = rec.comment.split(/\r?\n/)[0]?.trim() ?? '';
  const subject = firstLine.length > 70 ? `${firstLine.slice(0, 67)}…` : firstLine;
  const where = rec.file
    ? `${rec.file}:${rec.line ?? '?'}${rec.col != null ? `:${rec.col}` : ''}`
    : rec.selector;
  return [
    `pinagent: ${subject || 'agent edit'}`,
    '',
    'Landed via pinagent.',
    '',
    `Feedback: ${rec.id}`,
    `Target:   ${where}`,
    '',
  ].join('\n');
}
