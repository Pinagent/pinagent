// SPDX-License-Identifier: Elastic-2.0
//
// Entry point for the Pinagent cloud product.

export { PACKAGE_NAME as AUTH_PACKAGE } from '@pinagent/ee-auth';
export { PACKAGE_NAME as BILLING_PACKAGE } from '@pinagent/ee-billing';
export { PACKAGE_NAME as INFRA_PACKAGE } from '@pinagent/ee-infra';
export { PACKAGE_NAME as RELAY_PACKAGE } from '@pinagent/ee-relay';
export { PACKAGE_NAME as TEAM_FEATURES_PACKAGE } from '@pinagent/ee-team-features';

export { createBearerAuthenticator } from './authenticators';
export { type CloudConfig, loadCloudConfig } from './config';
export {
  createNeonMembershipStore,
  createPgMembershipStore,
  type MembershipDb,
} from './db/membership-store';
export { organizationMemberships, organizations, schema } from './db/schema';
export {
  type AuthenticatedUser,
  type Authenticator,
  createCloudFetch,
  devHeaderAuthenticator,
  handleCloudRequest,
  handleSessionRequest,
  type SessionServiceDeps,
} from './session-service';

export const PACKAGE_NAME = '@pinagent/cloud';
