// SPDX-License-Identifier: Elastic-2.0
import { boolean, index, integer, jsonb, pgSchema, primaryKey, text } from 'drizzle-orm/pg-core';

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

/**
 * Users provisioned just-in-time on SSO login — backs `@pinagent/ee-auth`'s
 * `UserStore`. Mirrors the `User` interface exactly. `id` is an opaque
 * synthetic id (the IdP-subject mapping lives in `sso_identities`); ISO-8601
 * `text` timestamps, consistent with the rest of the `auth` schema.
 */
export const users = authSchema.table('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  createdAt: text('created_at').notNull(),
  lastLoginAt: text('last_login_at').notNull(),
});

/**
 * Maps an external IdP identity `(connection_id, subject)` to an internal
 * synthetic `user_id` — backs the `(connectionId, subject) → userId`
 * resolution in `@pinagent/ee-auth`'s `UserStore`. The composite PK dedups the
 * identity; `user_id` is indexed so a user's identities can be listed. One
 * user may hold several identities (multiple IdP connections) all pointing at
 * the same `user_id`.
 */
export const ssoIdentities = authSchema.table(
  'sso_identities',
  {
    connectionId: text('connection_id').notNull(),
    subject: text('subject').notNull(),
    userId: text('user_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.connectionId, t.subject] }),
    index('sso_identities_user_id_idx').on(t.userId),
  ],
);

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
 * Configured IdP connections, one or more per org — backs
 * `@pinagent/ee-auth`'s `SsoConnectionStore`. Mirrors the `SsoConnection`
 * interface exactly. Stores connection *metadata* only: client credentials
 * stay with the provider's `clientFor` (keyed by id), so secrets never live
 * here. `protocol` is `text` (not a pg enum) per the repo convention; `domains`
 * is a JSON string array for email-domain IdP discovery.
 */
export const ssoConnections = authSchema.table('sso_connections', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  protocol: text('protocol').notNull(),
  issuer: text('issuer').notNull(),
  domains: jsonb('domains').$type<string[]>().notNull(),
  enabled: boolean('enabled').notNull(),
});

/**
 * Per-connection OIDC client credentials — backs `@pinagent/ee-auth`'s
 * `OidcCredentialStore`. Separate from `sso_connections` so the metadata store
 * stays secret-free and the public `SsoConnection` shape never carries a
 * secret. The `client_secret` is stored encrypted at rest (AES-256-GCM via
 * `sso-crypto.ts`): `secret_ciphertext` + `secret_iv` are base64url; the
 * plaintext is only recovered at the moment of the IdP handshake.
 */
export const ssoConnectionCredentials = authSchema.table('sso_connection_credentials', {
  connectionId: text('connection_id').primaryKey(),
  clientId: text('client_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  secretCiphertext: text('secret_ciphertext').notNull(),
  secretIv: text('secret_iv').notNull(),
});

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

/** One row per org: branch-routing policy (`ee-team-features`). */
export const branchRouting = teamSchema.table('branch_routing', {
  organizationId: text('organization_id').primaryKey(),
  /** Default base branch agents should target; null = repo default. */
  defaultBaseBranch: text('default_base_branch'),
  /** Glob patterns of branch names worktrees may land on; [] = allow any. */
  allowedBranchPatterns: jsonb('allowed_branch_patterns').$type<string[]>().notNull(),
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

/**
 * `relay` schema — live relay state the control plane derives from lifecycle
 * events. `active_sessions` is which agent-runner *device* sessions are
 * currently connected, per org; queried to target a control-plane → device
 * push. Maintained from `device.connected` / `device.disconnected` ingest.
 */
export const relaySchema = pgSchema('relay');

export const activeSessions = relaySchema.table(
  'active_sessions',
  {
    organizationId: text('organization_id').notNull(),
    sessionId: text('session_id').notNull(),
    connectedAt: text('connected_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.sessionId] })],
);

export const schema = {
  organizations,
  organizationMemberships,
  users,
  ssoIdentities,
  ssoConnections,
  ssoConnectionCredentials,
  auditEvents,
  costControls,
  branchRouting,
  usageEvents,
  subscriptions,
  activeSessions,
};
