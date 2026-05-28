// SPDX-License-Identifier: Apache-2.0
/**
 * `listBranches` — assemble the data the dock's Branches view needs.
 *
 * Walks every conversation with a worktree (`worktreePath !== null`,
 * worktreeState in 'active' | 'landed'). For each: shells out to git
 * for cleanliness + ahead/behind state, stats the directory for disk
 * usage, and returns a flat array shaped for the existing dock
 * Branch row layout.
 *
 * Disk usage uses `du -sk` because traversing the worktree in Node
 * for every refetch is slow on large projects and `du` is universally
 * available on every platform pinagent supports. We accept its small
 * overcount on tools like cp-on-write filesystems — the dock surfaces
 * the number as informational, not load-bearing.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { discardWorktree } from './agent';
import { recordAuditEvent } from './audit-log';
import { runGitCapture } from './git-utils';
import { enqueue } from './merge-queue';
import { SettingsStore } from './settings-store';
import { ID_RE, Storage } from './storage';

export interface BranchRecord {
  /** Stable id — uses the conversation id since 1 worktree = 1 conversation. */
  id: string;
  /** Branch name, e.g. `pinagent/cv_8a2f`. */
  name: string;
  conversationId: string;
  conversationTitle: string | null;
  /** Conversation `createdAt`; the worktree was made shortly after. */
  createdAt: string;
  /** Conversation `updatedAt` — the dock treats this as "last activity". */
  lastActivity: string;
  state: 'clean' | 'uncommitted' | 'behind-base';
  /** MiB on disk, rounded to nearest integer. Null when `du` fails. */
  diskMb: number | null;
}

export async function listBranches(projectRoot: string): Promise<BranchRecord[]> {
  const storage = new Storage(projectRoot);
  const all = await storage.list();
  const candidates = all.filter(
    (r) =>
      r.worktreePath !== null &&
      r.branch !== null &&
      (r.worktreeState === 'active' || r.worktreeState === 'landed'),
  );
  if (candidates.length === 0) return [];

  const baseRef = await resolveBaseRef(projectRoot);

  const rows = await Promise.all(
    candidates.map(async (rec): Promise<BranchRecord | null> => {
      if (!rec.worktreePath || !rec.branch) return null;
      if (!existsSync(rec.worktreePath)) return null;
      const [state, diskMb] = await Promise.all([
        computeBranchState(rec.worktreePath, baseRef),
        computeDiskMb(rec.worktreePath),
      ]);
      return {
        id: rec.id,
        name: rec.branch,
        conversationId: rec.id,
        conversationTitle: titleOf(rec.comment),
        createdAt: rec.createdAt,
        lastActivity: rec.updatedAt,
        state,
        diskMb,
      };
    }),
  );

  return rows
    .filter((r): r is BranchRecord => r !== null)
    .sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity));
}

async function resolveBaseRef(projectRoot: string): Promise<string> {
  const sym = await runGitCapture(projectRoot, ['symbolic-ref', '--short', 'HEAD']);
  if (sym.code === 0) return sym.stdout.trim();
  return 'HEAD';
}

async function computeBranchState(
  worktreePath: string,
  baseRef: string,
): Promise<BranchRecord['state']> {
  // Uncommitted edits override everything else — the user usually wants
  // to know about local dirt before stale-vs-base relationships.
  const status = await runGitCapture(worktreePath, ['status', '--porcelain']);
  if (status.code === 0 && status.stdout.trim().length > 0) return 'uncommitted';

  // Behind-base means base has commits the worktree doesn't — i.e. the
  // user's main branch advanced after the worktree was made. We don't
  // surface "ahead of base" because that's the expected state (the
  // agent's commits are the whole point of the worktree).
  const behindCount = await runGitCapture(worktreePath, [
    'rev-list',
    '--count',
    `HEAD..${baseRef}`,
  ]);
  if (behindCount.code === 0 && Number(behindCount.stdout.trim()) > 0) return 'behind-base';

  return 'clean';
}

/**
 * Run `du -sk <path>` and return MiB rounded to the nearest int. Returns
 * null on any failure (Windows, permission denied, `du` not on PATH).
 */
function computeDiskMb(worktreePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('du', ['-sk', worktreePath], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.on('error', () => resolve(null));
    child.on('exit', (code) => {
      if (code !== 0) return resolve(null);
      const k = Number(out.split(/\s+/, 1)[0]);
      if (!Number.isFinite(k)) return resolve(null);
      // KB → MiB with at-least-1 floor so a non-empty worktree never
      // reads as "0 MB" in the UI.
      resolve(Math.max(1, Math.round(k / 1024)));
    });
  });
}

function titleOf(comment: string): string | null {
  const first = comment.split('\n').find((l) => l.trim().length > 0);
  if (!first) return null;
  const t = first.trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

export interface PruneResult {
  ok: boolean;
  /** Conv id that was pruned, even on failure (caller may need to refetch). */
  feedbackId: string;
  error?: string;
}

/**
 * Tear down one conversation's worktree + branch by name. Same lifecycle
 * as `discardConversation` from the Conversations detail view — the
 * Branches view just calls into the same path so "discard" / "prune"
 * stay one verb at the storage layer.
 *
 * Goes through the merge queue so it serializes with any concurrent
 * land/discard on the same project.
 */
export async function pruneBranch(projectRoot: string, feedbackId: string): Promise<PruneResult> {
  const storage = new Storage(projectRoot);
  const rec = await storage.read(feedbackId);
  if (!rec) {
    return { ok: false, feedbackId, error: 'conversation not found' };
  }

  // Reuse the per-feedback log so the prune is recorded alongside the
  // conversation's history (matches `discardConversation` from WS).
  const logPath = join(projectRoot, '.pinagent', 'logs', `${feedbackId}.md`);
  await mkdir(join(projectRoot, '.pinagent', 'logs'), { recursive: true });

  try {
    await enqueue(projectRoot, () => discardWorktree(projectRoot, feedbackId, logPath));
    return { ok: true, feedbackId };
  } catch (e) {
    return {
      ok: false,
      feedbackId,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface PruneStaleResult {
  pruned: string[];
  failed: { feedbackId: string; error: string }[];
  /** Retention threshold (days) that was applied. Echoed for UI clarity. */
  retentionDays: number;
}

export interface BulkPruneResult {
  pruned: string[];
  failed: { feedbackId: string; error: string }[];
}

/**
 * Wire body for `POST /__pinagent/branches/bulk-prune`. Capped at 200
 * ids — well past the manual-select pain threshold and bounds the
 * worst-case request.
 */
export const BulkPruneBodySchema = z.object({
  feedbackIds: z.array(z.string().regex(ID_RE)).min(1).max(200),
});
export type BulkPruneBody = z.infer<typeof BulkPruneBodySchema>;

/**
 * Prune a hand-picked batch of worktrees. Each id goes through the
 * existing per-row `pruneBranch` so the worktree teardown + per-row
 * `conversation_discarded` audit emission stay intact; this function
 * adds ONE summary `worktrees_bulk_pruned` event covering the batch.
 *
 * Serial loop matches `pruneStaleBranches`: each prune already
 * serializes via the merge queue, so parallel calls wouldn't gain
 * anything and a linear loop keeps the result order predictable for
 * the dock's success toast.
 */
export async function pruneBranches(
  projectRoot: string,
  feedbackIds: string[],
): Promise<BulkPruneResult> {
  const pruned: string[] = [];
  const failed: { feedbackId: string; error: string }[] = [];

  for (const id of feedbackIds) {
    const result = await pruneBranch(projectRoot, id);
    if (result.ok) pruned.push(result.feedbackId);
    else failed.push({ feedbackId: result.feedbackId, error: result.error ?? 'unknown' });
  }

  if (pruned.length > 0) {
    await recordAuditEvent(projectRoot, {
      conversationId: null,
      actor: 'user',
      action: 'worktrees_bulk_pruned',
      payload: { ids: pruned, count: pruned.length },
    });
  }

  return { pruned, failed };
}

/**
 * Bulk-prune every branch whose `lastActivity` is older than the
 * project's configured `worktreeRetentionDays`. Reads the retention
 * from SettingsStore so the threshold matches what the dock displays
 * — no risk of "the dock said 9 stale, the server only pruned 7."
 */
export async function pruneStaleBranches(projectRoot: string): Promise<PruneStaleResult> {
  const settings = await new SettingsStore(projectRoot).read();
  const thresholdMs = settings.worktreeRetentionDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - thresholdMs;

  const branches = await listBranches(projectRoot);
  const stale = branches.filter((b) => Date.parse(b.lastActivity) < cutoff);

  const pruned: string[] = [];
  const failed: { feedbackId: string; error: string }[] = [];
  // Serial — each prune already goes through `enqueue`, so racing them
  // wouldn't gain anything and the linear loop keeps the result order
  // predictable for the caller's "pruned 3 worktrees" toast.
  for (const b of stale) {
    const result = await pruneBranch(projectRoot, b.conversationId);
    if (result.ok) pruned.push(result.feedbackId);
    else failed.push({ feedbackId: result.feedbackId, error: result.error ?? 'unknown' });
  }

  return { pruned, failed, retentionDays: settings.worktreeRetentionDays };
}
