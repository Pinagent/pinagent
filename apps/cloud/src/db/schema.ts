// SPDX-License-Identifier: Elastic-2.0
import { pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * Postgres schema backing `@pinagent/ee-auth`'s `MembershipStore`.
 *
 * Mirrors the `Organization` / `OrganizationMembership` interfaces exactly.
 * Timestamps are stored as ISO-8601 `text` (not `timestamptz`) so the rows
 * round-trip through the string-typed interface without Date conversion, and
 * `role` / `status` are `text` (not pg enums) following the repo convention
 * that new roles/statuses should land without a migration.
 */
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const organizationMemberships = pgTable(
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
