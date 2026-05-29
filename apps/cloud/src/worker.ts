// SPDX-License-Identifier: Elastic-2.0
import { createOidcProvider, type SsoConnection } from '@pinagent/ee-auth';
import { createCloudApp } from './app';
import { createBearerAuthenticator } from './authenticators';
import { type CloudConfig, loadCloudConfig } from './config';
import { createPgAuditSink } from './db/audit-sink';
import { createNeonDb } from './db/client';
import { createPgCostControlStore } from './db/cost-control-store';
import { createPgMembershipStore } from './db/membership-store';
import { createPgMeterSink } from './db/meter-sink';
import { createPgSsoConnectionStore } from './db/sso-connection-store';
import { createPgSubscriptionStore } from './db/subscription-store';

/**
 * Cloudflare Worker entry / composition root for the Pinagent cloud control
 * plane. Wires config + Neon membership store + OIDC provider + the session
 * and login services into one fetch handler. The app is built once per isolate
 * (the Neon pool and discovery cache are reused across requests).
 */

type CloudEnv = Record<string, string | undefined>;

let appPromise: Promise<{ fetch(request: Request): Promise<Response> }> | null = null;

export default {
  fetch(request: Request, env: CloudEnv): Promise<Response> {
    appPromise ??= buildApp(loadCloudConfig(env));
    return appPromise.then((app) => app.fetch(request));
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

  // Connections are resolved from a store now. Seed the env-configured one so
  // a single-connection deploy works with no DB rows; additional org IdPs can
  // be added as rows (credential provisioning for those is a follow-up — only
  // the configured connection has client credentials wired into `clientFor`).
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

  const provider = createOidcProvider({
    clientFor: (connection) => {
      if (connection.id !== config.oidc.connectionId) {
        throw new Error(`no OIDC client configured for connection "${connection.id}"`);
      }
      return {
        clientId: config.oidc.clientId,
        clientSecret: config.oidc.clientSecret,
        redirectUri: config.oidc.redirectUri,
      };
    },
    nonceSecret: config.oidcNonceSecret,
  });

  const authenticate = createBearerAuthenticator(config.userTokenSecret, {
    cookieName: config.sessionCookieName,
  });

  return createCloudApp({
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
      audit,
    },
    read: { store, authenticate, audit, meter },
    config: { store, authenticate, subscriptions, costControls },
    internal: { audit, relayInternalSecret: config.relayInternalSecret },
  });
}
