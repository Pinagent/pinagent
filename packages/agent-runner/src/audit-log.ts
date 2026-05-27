// SPDX-License-Identifier: Apache-2.0
/**
 * Audit log — append-only record of meaningful project actions. Backs
 * the dock's History → Activity tab.
 *
 * Emitted at the action sites (Storage.create, mergeWorktree,
 * discardWorktree, composePullRequest) rather than tailing every event
 * the WS bus carries: the goal is a human-readable trail of what
 * happened to each conversation, not a transaction log.
 *
 * Writes are best-effort — `recordAuditEvent` swallows DB errors so a
 * failed audit insert can never mask a successful land/discard/PR. The
 * read side is exposed via `listAuditEvents` and surfaces a single
 * GET /__pinagent/audit-log endpoint to the dock.
 */
import { auditEvents, desc, eq } from '@pinagent/db';
import { getDb } from './db/client';

export type AuditActor = 'agent' | 'user' | 'system';

/**
 * Open set — new actions land without a schema migration. Keep names
 * stable once shipped; the dock matches on them to render labels.
 */
export type AuditAction =
  | 'conversation_created'
  | 'conversation_landed'
  | 'conversation_discarded'
  | 'conversation_renamed'
  | 'conversation_archived'
  | 'conversation_unarchived'
  | 'pr_created';

export interface AuditEventRecord {
  /** DB row id as a string for React keys. */
  id: string;
  conversationId: string | null;
  actor: AuditActor;
  action: AuditAction | string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ListAuditEventsOpts {
  /** Cap result count. Default 100, max 500. */
  limit?: number;
  /** Skip the first N rows; pairs with `limit` for pagination. */
  offset?: number;
  /** Filter to events for one conversation (drilldown from a row). */
  conversationId?: string;
}

export interface RecordAuditEventInput {
  conversationId?: string | null;
  actor: AuditActor;
  action: AuditAction | string;
  payload?: Record<string, unknown>;
}

export async function recordAuditEvent(
  projectRoot: string,
  input: RecordAuditEventInput,
): Promise<void> {
  try {
    const db = getDb(projectRoot);
    await db.insert(auditEvents).values({
      conversationId: input.conversationId ?? null,
      actor: input.actor,
      action: input.action,
      payload: input.payload ?? {},
    });
  } catch {
    // Audit writes never fail the calling action. Drop silently — the
    // user's land/discard/PR has already succeeded by the time we get
    // here, and the dock will still reflect the right state via the
    // conversations table.
  }
}

export async function listAuditEvents(
  projectRoot: string,
  opts: ListAuditEventsOpts = {},
): Promise<AuditEventRecord[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const db = getDb(projectRoot);

  const where = opts.conversationId
    ? eq(auditEvents.conversationId, opts.conversationId)
    : undefined;
  const query = where ? db.select().from(auditEvents).where(where) : db.select().from(auditEvents);

  // Secondary sort on id breaks ties when multiple rows share a
  // createdAt (sqlite timestamps are ms-precision; back-to-back inserts
  // routinely collide). Without it, "newest first" isn't stable.
  const rows = await query
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    id: String(r.id),
    conversationId: r.conversationId,
    actor: r.actor,
    action: r.action,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
  }));
}
