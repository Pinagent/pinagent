// SPDX-License-Identifier: Elastic-2.0
import type {
  OrganizationId,
  SsoConnection,
  SsoConnectionStore,
  SsoProtocol,
} from '@pinagent/ee-auth';
import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { ssoConnections } from './schema';

/**
 * Postgres-backed {@link SsoConnectionStore} — the production replacement for
 * the single boot-time connection the login routes used to be handed.
 *
 * Written against the Drizzle query builder over {@link schema}, so it works
 * with any pg-dialect driver: Neon serverless in production, PGlite in tests.
 * Stores connection metadata only (no client secrets — those stay with the
 * OIDC provider's `clientFor`).
 */

/** Any Drizzle pg database; concrete drivers (neon, pglite) all satisfy this. */
// biome-ignore lint/suspicious/noExplicitAny: accept any driver-specific PgDatabase shape.
export type SsoConnectionDb = PgDatabase<any, any, any>;

export function createPgSsoConnectionStore(db: SsoConnectionDb): SsoConnectionStore {
  return {
    async get(connectionId: string): Promise<SsoConnection | null> {
      const [row] = await db
        .select()
        .from(ssoConnections)
        .where(eq(ssoConnections.id, connectionId))
        .limit(1);
      return row ? toConnection(row) : null;
    },

    async findByDomain(domain: string): Promise<SsoConnection | null> {
      const needle = domain.trim().toLowerCase();
      if (!needle) return null;
      // Domain match is done in SQL against the JSON array, lower-cased on
      // both sides so discovery is case-insensitive; only enabled rows.
      const [row] = await db
        .select()
        .from(ssoConnections)
        .where(
          and(
            eq(ssoConnections.enabled, true),
            sql`exists (
              select 1 from jsonb_array_elements_text(${ssoConnections.domains}) as d
              where lower(d) = ${needle}
            )`,
          ),
        )
        .limit(1);
      return row ? toConnection(row) : null;
    },

    async listByOrganization(org: OrganizationId): Promise<SsoConnection[]> {
      const rows = await db
        .select()
        .from(ssoConnections)
        .where(eq(ssoConnections.organizationId, org));
      return rows.map(toConnection);
    },

    async upsert(connection: SsoConnection): Promise<void> {
      await db
        .insert(ssoConnections)
        .values({
          id: connection.id,
          organizationId: connection.organizationId,
          protocol: connection.protocol,
          issuer: connection.issuer,
          domains: [...connection.domains],
          enabled: connection.enabled,
        })
        .onConflictDoUpdate({
          target: ssoConnections.id,
          set: {
            organizationId: connection.organizationId,
            protocol: connection.protocol,
            issuer: connection.issuer,
            domains: [...connection.domains],
            enabled: connection.enabled,
          },
        });
    },
  };
}

/** Narrow the text-typed `protocol` column back to its union type. */
function toConnection(row: typeof ssoConnections.$inferSelect): SsoConnection {
  return {
    id: row.id,
    organizationId: row.organizationId,
    protocol: row.protocol as SsoProtocol,
    issuer: row.issuer,
    domains: row.domains,
    enabled: row.enabled,
  };
}
