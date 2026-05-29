// SPDX-License-Identifier: Elastic-2.0
import type {
  MembershipStatus,
  MembershipStore,
  Organization,
  OrganizationId,
  OrganizationMembership,
  Role,
  UserId,
} from '@pinagent/ee-auth';
import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { organizationMemberships, organizations } from './schema';

/**
 * Postgres-backed {@link MembershipStore} — the production replacement for
 * `unimplementedMembershipStore`.
 *
 * Written against the Drizzle query builder over {@link schema}, so it works
 * with any pg-dialect driver: Neon serverless in production, PGlite in tests.
 * The composition root (`session-service`) injects the resulting store into
 * the relay session endpoint.
 */

/** Any Drizzle pg database; concrete drivers (neon, pglite) all satisfy this. */
// biome-ignore lint/suspicious/noExplicitAny: accept any driver-specific PgDatabase shape.
export type MembershipDb = PgDatabase<any, any, any>;

export function createPgMembershipStore(db: MembershipDb): MembershipStore {
  return {
    async getOrganization(id: OrganizationId): Promise<Organization | null> {
      const [row] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
      return row ?? null;
    },

    async listMembers(id: OrganizationId): Promise<OrganizationMembership[]> {
      const rows = await db
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.organizationId, id));
      return rows.map(toMembership);
    },

    async getMembership(org: OrganizationId, user: UserId): Promise<OrganizationMembership | null> {
      const [row] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org),
            eq(organizationMemberships.userId, user),
          ),
        )
        .limit(1);
      return row ? toMembership(row) : null;
    },

    async upsertMembership(membership: OrganizationMembership): Promise<void> {
      await db
        .insert(organizationMemberships)
        .values(membership)
        .onConflictDoUpdate({
          target: [organizationMemberships.organizationId, organizationMemberships.userId],
          set: {
            role: membership.role,
            status: membership.status,
            invitedAt: membership.invitedAt,
            joinedAt: membership.joinedAt,
          },
        });
    },

    async removeMembership(org: OrganizationId, user: UserId): Promise<void> {
      await db
        .delete(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, org),
            eq(organizationMemberships.userId, user),
          ),
        );
    },
  };
}

/**
 * Convenience constructor for production: build a Neon-serverless Drizzle
 * client and wrap it. Works in both Workers and Node.
 */
export async function createNeonMembershipStore(
  connectionString: string,
): Promise<MembershipStore> {
  const { Pool } = await import('@neondatabase/serverless');
  const { drizzle } = await import('drizzle-orm/neon-serverless');
  const db = drizzle(new Pool({ connectionString }));
  return createPgMembershipStore(db);
}

/** Narrow the text-typed `role`/`status` columns back to their union types. */
function toMembership(row: typeof organizationMemberships.$inferSelect): OrganizationMembership {
  return {
    organizationId: row.organizationId,
    userId: row.userId,
    role: row.role as Role,
    status: row.status as MembershipStatus,
    invitedAt: row.invitedAt,
    joinedAt: row.joinedAt,
  };
}
