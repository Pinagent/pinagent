// SPDX-License-Identifier: Elastic-2.0
import { pgSchema, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * Postgres schema backing `@pinagent/ee-auth`'s `MembershipStore`.
 *
 * Mirrors the `Organization` / `OrganizationMembership` interfaces exactly.
 * Timestamps are stored as ISO-8601 `text` (not `timestamptz`) so the rows
 * round-trip through the string-typed interface without Date conversion, and
 * `role` / `status` are `text` (not pg enums) following the repo convention
 * that new roles/statuses should land without a migration.
 *
 * Tables live in a per-domain `auth` schema rather than `public`: the cloud
 * DB is shared across EE concerns (auth, billing, team-features, …), so each
 * domain owns a schema. That keeps `GRANT USAGE` scoped per service role and
 * mirrors the package boundaries. New domains get their own schema.
 */
export const authSchema = pgSchema('auth');

export const organizations = authSchema.table('organizations', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const organizationMemberships = authSchema.table(
  'organization_memberships',
  {
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull(),
    invitedAt: text('invited_at').notNull(),
    joinedAt: text('joined_at'),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

export const schema = { organizations, organizationMemberships };
