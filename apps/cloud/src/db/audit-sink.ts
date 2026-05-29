// SPDX-License-Identifier: Elastic-2.0
import { type AuditEvent, type AuditSink, DEFAULT_AUDIT_LIMIT } from '@pinagent/ee-team-features';
import { desc, eq } from 'drizzle-orm';
import type { MembershipDb } from './membership-store';
import { auditEvents } from './schema';

/**
 * Postgres-backed {@link AuditSink} (the `team.audit_events` table). Append +
 * read-back over the Drizzle query builder, so it runs on any pg driver (Neon
 * in prod, PGlite in tests). The row id is an app-generated UUID — no DB
 * extension required.
 */
export function createPgAuditSink(db: MembershipDb): AuditSink {
  return {
    async record(event: AuditEvent): Promise<void> {
      await db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        occurredAt: event.occurredAt,
        organizationId: event.organizationId,
        actorUserId: event.actorUserId,
        action: event.action,
        targetId: event.targetId ?? null,
        metadata: event.metadata ?? null,
      });
    },

    async list(query): Promise<AuditEvent[]> {
      const rows = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organizationId, query.organizationId))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(query.limit ?? DEFAULT_AUDIT_LIMIT);
      return rows.map(toEvent);
    },
  };
}

function toEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    occurredAt: row.occurredAt,
    organizationId: row.organizationId,
    actorUserId: row.actorUserId,
    action: row.action,
    ...(row.targetId !== null ? { targetId: row.targetId } : {}),
    ...(row.metadata !== null ? { metadata: row.metadata } : {}),
  };
}
