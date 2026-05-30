// SPDX-License-Identifier: Elastic-2.0
import {
  type Invitation,
  type InvitationStore,
  normalizeEmail,
  type OrganizationId,
  type Role,
} from '@pinagent/ee-auth';
import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { invitations } from './schema';

/**
 * Postgres-backed {@link InvitationStore} — pending org invitations, keyed by
 * `(organization_id, email)`. Email is normalized at the boundary so lookups
 * are case-insensitive. Mirrors the membership adapter; works with any
 * pg-dialect driver (Neon in prod, PGlite in tests).
 */

/** Any Drizzle pg database; concrete drivers (neon, pglite) all satisfy this. */
// biome-ignore lint/suspicious/noExplicitAny: accept any driver-specific PgDatabase shape.
export type InvitationDb = PgDatabase<any, any, any>;

export function createPgInvitationStore(db: InvitationDb): InvitationStore {
  return {
    async upsert(invitation: Invitation): Promise<void> {
      const row = { ...invitation, email: normalizeEmail(invitation.email) };
      await db
        .insert(invitations)
        .values(row)
        .onConflictDoUpdate({
          target: [invitations.organizationId, invitations.email],
          set: { role: row.role, invitedAt: row.invitedAt, invitedByUserId: row.invitedByUserId },
        });
    },

    async listByOrg(organizationId: OrganizationId): Promise<Invitation[]> {
      const rows = await db
        .select()
        .from(invitations)
        .where(eq(invitations.organizationId, organizationId));
      return rows.map(toInvitation);
    },

    async get(organizationId: OrganizationId, email: string): Promise<Invitation | null> {
      const [row] = await db
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, organizationId),
            eq(invitations.email, normalizeEmail(email)),
          ),
        )
        .limit(1);
      return row ? toInvitation(row) : null;
    },

    async remove(organizationId: OrganizationId, email: string): Promise<void> {
      await db
        .delete(invitations)
        .where(
          and(
            eq(invitations.organizationId, organizationId),
            eq(invitations.email, normalizeEmail(email)),
          ),
        );
    },
  };
}

/** Narrow the text-typed `role` column back to its union type. */
function toInvitation(row: typeof invitations.$inferSelect): Invitation {
  return {
    organizationId: row.organizationId,
    email: row.email,
    role: row.role as Role,
    invitedAt: row.invitedAt,
    invitedByUserId: row.invitedByUserId,
  };
}
