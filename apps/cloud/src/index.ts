// SPDX-License-Identifier: Elastic-2.0
//
// Entry point for the Pinagent cloud product.

export { PACKAGE_NAME as AUTH_PACKAGE } from '@pinagent/ee-auth';
export { PACKAGE_NAME as BILLING_PACKAGE } from '@pinagent/ee-billing';
export { PACKAGE_NAME as INFRA_PACKAGE } from '@pinagent/ee-infra';
export { PACKAGE_NAME as RELAY_PACKAGE } from '@pinagent/ee-relay';
export { PACKAGE_NAME as TEAM_FEATURES_PACKAGE } from '@pinagent/ee-team-features';

export { type CloudAppDeps, createCloudApp } from './app';
export { createBearerAuthenticator } from './authenticators';
export { type CloudConfig, loadCloudConfig, type OidcConnectionConfig } from './config';
export {
  type ConfigServiceDeps,
  handleBranchRoutingConfig,
  handleCostControlConfig,
  handleSubscriptionConfig,
} from './config-service';
export { createPgActiveSessionStore } from './db/active-session-store';
export { createPgAuditSink } from './db/audit-sink';
export { createPgBranchRoutingStore } from './db/branch-routing-store';
export { createNeonDb } from './db/client';
export { createPgCostControlStore } from './db/cost-control-store';
export {
  createNeonMembershipStore,
  createPgMembershipStore,
  type MembershipDb,
} from './db/membership-store';
export { createPgMeterSink } from './db/meter-sink';
export {
  auditEvents,
  branchRouting,
  costControls,
  organizationMemberships,
  organizations,
  schema,
  subscriptions,
  usageEvents,
} from './db/schema';
export { createPgSubscriptionStore } from './db/subscription-store';
export { handleRelayEvents, type InternalServiceDeps } from './internal-service';
export { handleSsoCallback, handleSsoStart, type LoginServiceDeps } from './login-service';
export {
  handleAudit,
  handleMembers,
  handleUsage,
  type ReadServiceDeps,
} from './read-service';
export {
  type AuthenticatedUser,
  type Authenticator,
  createCloudFetch,
  devHeaderAuthenticator,
  handleCloudRequest,
  handleSessionRequest,
  type SessionServiceDeps,
} from './session-service';
export { type LoginState, signLoginState, verifyLoginState } from './sso-state';

export const PACKAGE_NAME = '@pinagent/cloud';
