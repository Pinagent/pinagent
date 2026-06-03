// SPDX-License-Identifier: Elastic-2.0
import { type BillingServiceDeps, handleBillingRoll } from './billing-service';
import {
  type ConfigServiceDeps,
  handleBranchRoutingConfig,
  handleCostControlConfig,
  handleSubscriptionConfig,
} from './config-service';
import { handleRelayEvents, type InternalServiceDeps } from './internal-service';
import { handleSsoCallback, handleSsoStart, type LoginServiceDeps } from './login-service';
import { handleInvitations, handleMemberWrite, type MemberServiceDeps } from './member-service';
import {
  handleAudit,
  handleMembers,
  handleMyOrgs,
  handleUsage,
  type ReadServiceDeps,
} from './read-service';
import { handleSessionRequest, type SessionServiceDeps } from './session-service';

/**
 * The cloud control-plane HTTP surface, composed from the session, login,
 * read, and config services. Framework-agnostic (`{ fetch }`), so `worker.ts`
 * (or a Node server) just builds the deps and forwards requests here.
 *
 *   GET      /sso/start        → begin IdP login
 *   GET      /sso/callback     → complete login, set session cookie
 *   POST     /sessions         → exchange the session for a relay token
 *   GET      /usage            → usage summary (admin read)
 *   GET      /audit            → audit events (admin read)
 *   GET      /members          → organization members (admin read)
 *   PATCH/DELETE /members     → change a member's role / remove a member
 *   GET/POST/DELETE /invitations → list / invite / revoke (admin)
 *   GET/PUT  /subscriptions    → read/set the org's plan (admin config)
 *   GET/PUT  /cost-controls    → read/set the org's cost cap (admin config)
 *   GET/PUT  /branch-routing   → read/set the org's branch policy (admin config)
 *   POST     /internal/relay/events → relay lifecycle ingest (service auth)
 *   POST     /internal/billing/roll → advance elapsed billing periods (service auth)
 *   GET      /healthz          → liveness
 */
export interface CloudAppDeps {
  session: SessionServiceDeps;
  login: LoginServiceDeps;
  read: ReadServiceDeps;
  config: ConfigServiceDeps;
  members: MemberServiceDeps;
  billing: BillingServiceDeps;
  internal: InternalServiceDeps;
}

export function createCloudApp(deps: CloudAppDeps): {
  fetch(request: Request, waitUntil?: (promise: Promise<unknown>) => void): Promise<Response>;
} {
  return {
    fetch(request: Request, waitUntil?: (promise: Promise<unknown>) => void): Promise<Response> {
      const { pathname } = new URL(request.url);
      switch (pathname) {
        case '/sso/start':
          return handleSsoStart(request, deps.login);
        case '/sso/callback':
          return handleSsoCallback(request, deps.login);
        case '/sessions':
          // `waitUntil` lets the session handler fire a usage-cap alert email
          // after the response, off the per-org issuance lock.
          return handleSessionRequest(request, deps.session, waitUntil);
        case '/usage':
          return handleUsage(request, deps.read);
        case '/audit':
          return handleAudit(request, deps.read);
        case '/members':
          // GET reads the roster; DELETE/PATCH mutate a member (member-service).
          return request.method === 'GET'
            ? handleMembers(request, deps.read)
            : handleMemberWrite(request, deps.members);
        case '/invitations':
          return handleInvitations(request, deps.members);
        case '/me/orgs':
          return handleMyOrgs(request, deps.read);
        case '/subscriptions':
          return handleSubscriptionConfig(request, deps.config);
        case '/cost-controls':
          return handleCostControlConfig(request, deps.config);
        case '/branch-routing':
          return handleBranchRoutingConfig(request, deps.config);
        case '/internal/relay/events':
          return handleRelayEvents(request, deps.internal);
        case '/internal/billing/roll':
          return handleBillingRoll(request, deps.billing);
        case '/healthz':
          return Promise.resolve(new Response('ok', { status: 200 }));
        default:
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'not found' }), {
              status: 404,
              headers: { 'content-type': 'application/json' },
            }),
          );
      }
    },
  };
}
