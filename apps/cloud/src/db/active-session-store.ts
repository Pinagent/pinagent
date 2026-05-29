// SPDX-License-Identifier: Elastic-2.0
import type { ActiveSession, ActiveSessionRegistry } from '@pinagent/ee-relay';
import { and, eq } from 'drizzle-orm';
import type { MembershipDb } from './membership-store';
import { activeSessions } from './schema';

/**
 * Postgres-backed {@link ActiveSessionRegistry} (the `relay.active_sessions`
 * table) — one row per connected device session. Drizzle query builder, so it
 * runs on Neon (prod) and PGlite (tests).
 */
export function createPgActiveSessionStore(db: MembershipDb): ActiveSessionRegistry {
  return {
    async recordConnected(session: ActiveSession): Promise<void> {
      await db
        .insert(activeSessions)
        .values(session)
        .onConflictDoUpdate({
          target: [activeSessions.organizationId, activeSessions.sessionId],
          set: { connectedAt: session.connectedAt },
        });
    },

    async recordDisconnected(organizationId: string, sessionId: string): Promise<void> {
      await db
        .delete(activeSessions)
        .where(
          and(
            eq(activeSessions.organizationId, organizationId),
            eq(activeSessions.sessionId, sessionId),
          ),
        );
    },

    async listByOrg(organizationId: string): Promise<ActiveSession[]> {
      const rows = await db
        .select()
        .from(activeSessions)
        .where(eq(activeSessions.organizationId, organizationId));
      return rows.map((r) => ({
        organizationId: r.organizationId,
        sessionId: r.sessionId,
        connectedAt: r.connectedAt,
      }));
    },
  };
}
