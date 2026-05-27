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
import { runGitCapture } from './git-utils';
import { Storage } from './storage';

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
