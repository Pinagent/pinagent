/**
 * Phase H — orphan-worktree TTL sweep.
 *
 * On dev-server boot, scan SQLite for conversations whose worktree has been
 * sitting in `worktreeState='active'` past the configured TTL. Add each one
 * to an in-memory set; next time the widget subscribes to that feedback,
 * the WS server overrides the initial `worktree_state` emission from
 * `active` to `ttl_warning` so the UI nudges the user to land or discard.
 *
 * We do NOT auto-discard: the user might genuinely want a multi-week
 * worktree, and silent data loss is the worst failure mode for a tool
 * whose pitch is "trust what the agents did". TTL is advisory only.
 *
 * Env:
 *   PINAGENT_WORKTREE_TTL_DAYS (default 7) — days since last update
 *     before a worktree is flagged. Set to 0 to disable the sweep.
 */

import { and, conversations, eq, lt } from '@pinagent/db';
import { getDb } from './db/client';

const DEFAULT_TTL_DAYS = 7;

const TTL_SYMBOL = Symbol.for('pinagent.worktree-ttl.flagged');
const flagged: Set<string> =
  ((globalThis as Record<symbol, unknown>)[TTL_SYMBOL] as Set<string> | undefined) ??
  new Set<string>();
(globalThis as Record<symbol, unknown>)[TTL_SYMBOL] = flagged;

function ttlDays(env: NodeJS.ProcessEnv): number {
  const raw = env.PINAGENT_WORKTREE_TTL_DAYS;
  if (raw === undefined || raw === '') return DEFAULT_TTL_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TTL_DAYS;
  return n;
}

/**
 * One-shot scan at startup. Idempotent — re-running just refreshes the
 * flag set. Best-effort; swallows DB errors so a dev-server boot is
 * never blocked by a TTL sweep failure.
 */
export async function sweepStaleWorktrees(projectRoot: string): Promise<void> {
  const days = ttlDays(process.env);
  if (days === 0) {
    flagged.clear();
    return;
  }
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const db = getDb(projectRoot);
    const rows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.worktreeState, 'active'), lt(conversations.updatedAt, cutoff)));
    flagged.clear();
    for (const r of rows) flagged.add(r.id);
  } catch {
    // Best-effort — leave the prior set intact.
  }
}

/**
 * True iff the most recent sweep flagged this conversation. Returns false
 * after the user has taken an action (land/discard) and `clearWarning`
 * was called.
 */
export function isStale(feedbackId: string): boolean {
  return flagged.has(feedbackId);
}

/**
 * Drop a feedback from the flagged set. Called from the WS server's
 * `land_request` / `discard_request` handlers so the warning doesn't
 * reappear for repeat subscribes after the user has acted.
 */
export function clearWarning(feedbackId: string): void {
  flagged.delete(feedbackId);
}

/** Test-only inspection. */
export function _flaggedForTests(): ReadonlySet<string> {
  return flagged;
}
