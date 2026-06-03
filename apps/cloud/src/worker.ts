// SPDX-License-Identifier: Elastic-2.0
import { createOidcProvider, type SsoConnection } from '@pinagent/ee-auth';
import { noopBillingReporter } from '@pinagent/ee-billing';
import { createCloudApp } from './app';
import { createBearerAuthenticator } from './authenticators';
import { type BillingServiceDeps, runBillingRollover } from './billing-service';
import { type CloudConfig, loadCloudConfig } from './config';
import { createPgActiveSessionStore } from './db/active-session-store';
import { createPgAuditSink } from './db/audit-sink';
import { createPgBranchRoutingStore } from './db/branch-routing-store';
import { createNeonDb } from './db/client';
import { createPgCostControlStore } from './db/cost-control-store';
import { createPgInvitationStore } from './db/invitation-store';
import { createPgIssuanceLock } from './db/issuance-lock';
import { createPgMembershipStore } from './db/membership-store';
import { createPgMeterSink } from './db/meter-sink';
import { createPgOidcCredentialStore } from './db/oidc-credential-store';
import { createPgSsoConnectionStore } from './db/sso-connection-store';
import { createPgSubscriptionStore } from './db/subscription-store';
import { createPgUserStore } from './db/user-store';
import { createOidcClientResolver } from './oidc-client';
import { createRelayClient } from './relay-client';

/**
 * Cloudflare Worker entry / composition root for the Pinagent cloud control
 * plane. Wires config + Neon membership store + OIDC provider + the session
 * and login services into one fetch handler. The app is built once per isolate
 * (the Neon pool and discovery cache are reused across requests).
 */

type CloudEnv = Record<string, string | undefined>;

interface BuiltApp {
  fetch(request: Request): Promise<Response>;
  runRollover(): Promise<{ rolled: number }>;
}

let appPromise: Promise<BuiltApp> | null = null;

function built(env: CloudEnv): Promise<BuiltApp> {
  appPromise ??= buildApp(loadCloudConfig(env));
  return appPromise;
}

export default {
  fetch(request: Request, env: CloudEnv): Promise<Response> {
    return built(env).then((app) => app.fetch(request));
  },
  // Cloudflare Cron Trigger (see wrangler.toml) — advance elapsed billing
  // periods. Loosely typed to avoid a hard dependency on @cloudflare/workers-types.
  scheduled(_event: unknown, env: CloudEnv, ctx: { waitUntil(p: Promise<unknown>): void }): void {
    ctx.waitUntil(built(env).then((app) => app.runRollover()));
  },
};

async function buildApp(config: CloudConfig) {
  // One Neon connection pool shared by every Postgres adapter.
  const db = await createNeonDb(config.databaseUrl);
  const store = createPgMembershipStore(db);
  const audit = createPgAuditSink(db);
  const meter = createPgMeterSink(db);
  const subscriptions = createPgSubscriptionStore(db);
  const costControls = createPgCostControlStore(db);
  const users = createPgUserStore(db);
  const invitations = createPgInvitationStore(db);
  const branchRouting = createPgBranchRoutingStore(db);
  const activeSessions = createPgActiveSessionStore(db);
  // Serializes the quota/cost gate per org across isolates (advisory lock).
  const issuanceLock = createPgIssuanceLock(db);
  // Control-plane → device push, reusing the relay's internal secret. Lets a
  // branch-routing PUT reach the org's live sessions (see config-service).
  const relay = createRelayClient({
    baseUrl: config.relayPublicUrl,
    secret: config.relayInternalSecret,
  });

  // Connections are resolved from a store. Seed the env-configured one so a
  // single-connection deploy works with no DB rows; additional org IdPs are
  // added as rows, with their (encrypted) client credentials in the credential
  // store — resolved per connection by `clientFor`.
  const connections = createPgSsoConnectionStore(db);
  const configuredConnection: SsoConnection = {
    id: config.oidc.connectionId,
    organizationId: config.oidc.organizationId,
    protocol: 'oidc',
    issuer: config.oidc.issuer,
    domains: [],
    enabled: true,
  };
  await connections.upsert(configuredConnection);

  // Per-connection credentials are encrypted at rest under the KEK. Without a
  // KEK only the env-configured connection can authenticate (its creds come
  // from config, not the store).
  const credentials = config.ssoConnectionKek
    ? createPgOidcCredentialStore(db, config.ssoConnectionKek)
    : null;

  const provider = createOidcProvider({
    clientFor: createOidcClientResolver({
      configuredConnectionId: config.oidc.connectionId,
      configuredClient: {
        clientId: config.oidc.clientId,
        clientSecret: config.oidc.clientSecret,
        redirectUri: config.oidc.redirectUri,
      },
      credentials,
    }),
    nonceSecret: config.oidcNonceSecret,
  });

  const authenticate = createBearerAuthenticator(config.userTokenSecret, {
    cookieName: config.sessionCookieName,
  });

  // Billing-period rollover. `noopBillingReporter` is the Stripe seam — a
  // `createStripeReporter` (needs API keys) replaces it later. Triggered by the
  // `scheduled()` Cron handler and the `/internal/billing/roll` endpoint.
  const billing: BillingServiceDeps = {
    subscriptions,
    reporter: noopBillingReporter,
    audit,
    now: () => new Date().toISOString(),
    internalSecret: config.billingInternalSecret,
  };

  const app = createCloudApp({
    session: {
      store,
      authenticate,
      secret: config.relayAuthSecret,
      relayUrl: config.relayPublicUrl,
      ttlSeconds: config.sessionTtlSeconds,
      audit,
      meter,
      subscriptions,
      costControls,
      issuanceLock,
    },
    login: {
      provider,
      connections,
      defaultConnectionId: config.oidc.connectionId,
      stateSecret: config.ssoStateSecret,
      userTokenSecret: config.userTokenSecret,
      userTokenTtlSeconds: config.userTokenTtlSeconds,
      cookieName: config.sessionCookieName,
      defaultReturnTo: config.loginReturnTo,
      users,
      invitations,
      memberships: store,
      audit,
    },
    read: { store, users, authenticate, audit, meter },
    members: { store, users, invitations, authenticate, audit },
    config: {
      store,
      authenticate,
      subscriptions,
      costControls,
      branchRouting,
      activeSessions,
      relay,
    },
    billing,
    internal: { audit, meter, activeSessions, relayInternalSecret: config.relayInternalSecret },
  });

  return {
    fetch: (request: Request) => app.fetch(request),
    runRollover: () => runBillingRollover(billing),
  };
}
