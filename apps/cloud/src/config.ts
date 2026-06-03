// SPDX-License-Identifier: Elastic-2.0

/**
 * Cloud runtime configuration, read from the environment at the composition
 * root (`worker.ts`). Kept separate from the request handlers so they stay
 * pure, fully-injected functions.
 */

/** A single configured OIDC identity-provider connection. */
export interface OidcConnectionConfig {
  /** Stable id for this connection (echoed in the signed SSO state). */
  connectionId: string;
  /** The organization this connection logs users into. */
  organizationId: string;
  /** IdP issuer URL (used for `.well-known` discovery). */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Registered callback URL (our `/sso/callback`). */
  redirectUri: string;
}

export interface CloudConfig {
  /** HMAC secret shared with the relay for signing relay session tokens. */
  relayAuthSecret: string;
  /** Public wss URL of the relay, handed to clients in the session response. */
  relayPublicUrl: string;
  /** Neon/Postgres connection string for the membership store. */
  databaseUrl: string;
  /** HMAC secret this service signs + verifies user-identity tokens with. */
  userTokenSecret: string;
  /** HMAC secret for the signed, stateless SSO login `state`. */
  ssoStateSecret: string;
  /** HMAC secret the OIDC provider derives the per-request `nonce` from. */
  oidcNonceSecret: string;
  /** Shared secret the relay presents when reporting lifecycle events. */
  relayInternalSecret: string;
  /**
   * Shared secret the billing-rollover trigger (`POST /internal/billing/roll`)
   * presents. Distinct from {@link relayInternalSecret} on purpose: the relay
   * and the billing cron are different trust domains, so a party holding one
   * secret can't drive the other's endpoint.
   */
  billingInternalSecret: string;
  /**
   * base64url AES-256 key (32 bytes) for encrypting additional connections'
   * OIDC client secrets at rest. Optional — without it only the env-configured
   * connection can authenticate; stored per-connection credentials need it.
   */
  ssoConnectionKek?: string;
  /**
   * Stripe secret key for the billing reporter. Optional — with both this and
   * {@link stripeMeterEventName} set, period rollover reports usage to Stripe;
   * otherwise rollover uses the no-op reporter.
   */
  stripeSecretKey?: string;
  /** Stripe Billing Meter `event_name` the reporter posts usage against. */
  stripeMeterEventName?: string;
  /** The configured OIDC connection. */
  oidc: OidcConnectionConfig;
  /** Where to send the browser after a successful login (default `/`). */
  loginReturnTo: string;
  /** Cookie the user token is set in (default `pa_session`). */
  sessionCookieName: string;
  /** Relay-session-token lifetime, seconds (optional override). */
  sessionTtlSeconds?: number;
  /** User-token lifetime, seconds (optional override). */
  userTokenTtlSeconds?: number;
  /** Resend API key. Email sending is a no-op when unset (dev/self-host). */
  resendApiKey?: string;
  /** From header for outbound email, e.g. `Pinagent <noreply@pinagent.dev>`. */
  emailFrom?: string;
  /** Absolute dashboard base URL, used to build email links (e.g. the invite CTA). */
  appBaseUrl?: string;
}

/**
 * Build {@link CloudConfig} from an env bag (`process.env` or a Worker `Env`).
 * Throws on any missing required value so a misconfigured deploy fails at boot
 * rather than at the first request.
 */
export function loadCloudConfig(env: Record<string, string | undefined>): CloudConfig {
  return {
    relayAuthSecret: required(env, 'RELAY_AUTH_SECRET'),
    relayPublicUrl: required(env, 'PINAGENT_RELAY_PUBLIC_URL'),
    databaseUrl: required(env, 'DATABASE_URL'),
    userTokenSecret: required(env, 'USER_TOKEN_SECRET'),
    ssoStateSecret: required(env, 'SSO_STATE_SECRET'),
    oidcNonceSecret: required(env, 'OIDC_NONCE_SECRET'),
    relayInternalSecret: required(env, 'RELAY_INTERNAL_SECRET'),
    billingInternalSecret: required(env, 'BILLING_INTERNAL_SECRET'),
    ssoConnectionKek: env.SSO_CONNECTION_KEK,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeMeterEventName: env.STRIPE_METER_EVENT_NAME,
    oidc: {
      connectionId: required(env, 'OIDC_CONNECTION_ID'),
      organizationId: required(env, 'OIDC_ORG_ID'),
      issuer: required(env, 'OIDC_ISSUER'),
      clientId: required(env, 'OIDC_CLIENT_ID'),
      clientSecret: required(env, 'OIDC_CLIENT_SECRET'),
      redirectUri: required(env, 'OIDC_REDIRECT_URI'),
    },
    loginReturnTo: env.LOGIN_RETURN_TO ?? '/',
    sessionCookieName: env.SESSION_COOKIE_NAME ?? 'pa_session',
    sessionTtlSeconds: positiveInt(env, 'SESSION_TTL_SECONDS'),
    userTokenTtlSeconds: positiveInt(env, 'USER_TOKEN_TTL_SECONDS'),
    resendApiKey: env.RESEND_API_KEY,
    emailFrom: env.EMAIL_FROM,
    appBaseUrl: env.APP_BASE_URL,
  };
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function positiveInt(env: Record<string, string | undefined>, key: string): number | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}
