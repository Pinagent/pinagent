// SPDX-License-Identifier: Elastic-2.0
import { integer, jsonb, pgSchema, primaryKey, text } from 'drizzle-orm/pg-core';

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

/**
 * `team` schema — governance/team features. The append-only audit log
 * (`@pinagent/ee-team-features`'s `AuditSink`). Per the per-domain-schema
 * convention, team-features tables live here rather than in `auth`.
 */
export const teamSchema = pgSchema('team');

export const auditEvents = teamSchema.table('audit_events', {
  /** App-generated UUID (no DB extension needed). */
  id: text('id').primaryKey(),
  occurredAt: text('occurred_at').notNull(),
  organizationId: text('organization_id').notNull(),
  /** Null for unauthenticated actors (e.g. a denied login). */
  actorUserId: text('actor_user_id'),
  action: text('action').notNull(),
  targetId: text('target_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
});

/** One row per org: an admin-set cost guardrail (`ee-team-features`). */
export const costControls = teamSchema.table('cost_controls', {
  organizationId: text('organization_id').primaryKey(),
  /** Cap on relay sessions per billing period; null = no cap. */
  maxRelaySessionsPerPeriod: integer('max_relay_sessions_per_period'),
  /** `block` | `warn`. Text, not an enum, per the repo convention. */
  enforcement: text('enforcement').notNull(),
});

/**
 * `billing` schema — usage metering (`@pinagent/ee-billing`'s `MeterSink`).
 * Append-only usage events, summed per org for plan/quota and Stripe reporting.
 */
export const billingSchema = pgSchema('billing');

export const usageEvents = billingSchema.table('usage_events', {
  /** App-generated UUID (no DB extension needed). */
  id: text('id').primaryKey(),
  occurredAt: text('occurred_at').notNull(),
  organizationId: text('organization_id').notNull(),
  kind: text('kind').notNull(),
  quantity: integer('quantity').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
});

/** One row per org: which plan it's on and the current billing period start. */
export const subscriptions = billingSchema.table('subscriptions', {
  organizationId: text('organization_id').primaryKey(),
  planId: text('plan_id').notNull(),
  currentPeriodStart: text('current_period_start').notNull(),
});

export const schema = {
  organizations,
  organizationMemberships,
  auditEvents,
  costControls,
  usageEvents,
  subscriptions,
};
