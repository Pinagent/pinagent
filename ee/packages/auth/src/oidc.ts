// SPDX-License-Identifier: Elastic-2.0
import { SsoError } from './errors';
import { type Jwks, verifyIdToken } from './jwt';
import type { SsoConnection, SsoProfile, SsoProvider } from './sso';

/**
 * Concrete OIDC implementation of {@link SsoProvider} — the authorization-code
 * flow for a confidential client.
 *
 * The `SsoProvider` interface only round-trips `state` between
 * `authorizationUrl` and `completeLogin` (no place to stash a PKCE verifier),
 * so this is a confidential-client flow: `state` provides CSRF protection, the
 * code is exchanged with the `client_secret`, and the returned ID token is
 * fully validated (JWKS RS256 signature + iss/aud/exp). For replay protection
 * we bind a `nonce` to the request *statelessly* — derived as
 * HMAC(nonceSecret, state) — so it survives the round-trip without server-side
 * storage and is re-derived and checked in `completeLogin`.
 */

export interface OidcClientConfig {
  clientId: string;
  clientSecret: string;
  /** The registered callback URL. */
  redirectUri: string;
  /** OAuth scopes; defaults to `['openid', 'email', 'profile']`. */
  scopes?: readonly string[];
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OidcProviderConfig {
  /** Resolve the OIDC client credentials + redirect URI for a connection. */
  clientFor: (connection: SsoConnection) => OidcClientConfig | Promise<OidcClientConfig>;
  /** HMAC key used to derive the per-request `nonce` from `state`. */
  nonceSecret: string;
  /** Injected fetch (defaults to global `fetch`). */
  fetch?: FetchLike;
  /** Clock, epoch seconds (defaults to `Date.now`). For tests. */
  nowSeconds?: () => number;
}

interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const DEFAULT_SCOPES = ['openid', 'email', 'profile'] as const;

/** Drop trailing slashes so an issuer compares/serializes canonically. */
function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

export function createOidcProvider(config: OidcProviderConfig): SsoProvider {
  const fetchFn: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const now = config.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const metadataCache = new Map<string, OidcMetadata>();

  async function discover(issuer: string): Promise<OidcMetadata> {
    const cached = metadataCache.get(issuer);
    if (cached) return cached;
    const url = `${trimTrailingSlash(issuer)}/.well-known/openid-configuration`;
    const res = await fetchFn(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new SsoError(`OIDC discovery failed (${res.status})`);
    const meta = (await res.json()) as Partial<OidcMetadata>;
    if (!meta.authorization_endpoint || !meta.token_endpoint || !meta.jwks_uri || !meta.issuer) {
      throw new SsoError('OIDC discovery document missing required endpoints');
    }
    // RFC 8414 §3.3 / OIDC Discovery: the metadata's `issuer` MUST match the
    // issuer we requested discovery for. This is the trust anchor — every
    // endpoint we then call (authorize/token/jwks) AND the `iss` we later
    // accept on the ID token come from this document, so without the check a
    // discovery response an attacker can influence (DNS/MITM on a non-pinned
    // issuer, or an issuer that redirects) could swap them all out.
    if (trimTrailingSlash(meta.issuer) !== trimTrailingSlash(issuer)) {
      throw new SsoError('OIDC discovery issuer mismatch');
    }
    const full = meta as OidcMetadata;
    metadataCache.set(issuer, full);
    return full;
  }

  return {
    async authorizationUrl(connection: SsoConnection, state: string): Promise<string> {
      const [meta, client] = await Promise.all([
        discover(connection.issuer),
        config.clientFor(connection),
      ]);
      const url = new URL(meta.authorization_endpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', client.clientId);
      url.searchParams.set('redirect_uri', client.redirectUri);
      url.searchParams.set('scope', (client.scopes ?? DEFAULT_SCOPES).join(' '));
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', await deriveOidcNonce(config.nonceSecret, state));
      return url.toString();
    },

    async completeLogin(connection: SsoConnection, callback): Promise<SsoProfile> {
      const [meta, client] = await Promise.all([
        discover(connection.issuer),
        config.clientFor(connection),
      ]);

      const idToken = await exchangeCode(fetchFn, meta.token_endpoint, callback.payload, client);
      const jwks = await fetchJwks(fetchFn, meta.jwks_uri);
      const claims = await verifyIdToken(idToken, jwks, {
        issuer: meta.issuer,
        audience: client.clientId,
        nonce: await deriveOidcNonce(config.nonceSecret, callback.state),
        nowSeconds: now(),
      });

      // Only trust the email when the IdP asserts `email_verified === true`.
      // An unverified (or unasserted) email is dropped to '' so it can't be
      // used to claim another user's pending invitation or be matched for an
      // immediate membership grant. Identity is keyed on (connectionId, sub),
      // not email, so login still succeeds — only email-dependent features
      // (invite consumption, the members roster) degrade for that user.
      const emailVerified = claims.email_verified === true;
      return {
        connectionId: connection.id,
        subject: claims.sub,
        email: emailVerified && typeof claims.email === 'string' ? claims.email : '',
        displayName: typeof claims.name === 'string' ? claims.name : null,
        groups: Array.isArray(claims.groups) ? claims.groups.map(String) : [],
      };
    },
  };
}

async function exchangeCode(
  fetchFn: FetchLike,
  tokenEndpoint: string,
  code: string,
  client: OidcClientConfig,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: client.redirectUri,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  const res = await fetchFn(tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new SsoError(`OIDC token exchange failed (${res.status})`);
  const tokens = (await res.json()) as { id_token?: unknown };
  if (typeof tokens.id_token !== 'string') {
    throw new SsoError('OIDC token response missing id_token');
  }
  return tokens.id_token;
}

async function fetchJwks(fetchFn: FetchLike, jwksUri: string): Promise<Jwks> {
  const res = await fetchFn(jwksUri, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new SsoError(`JWKS fetch failed (${res.status})`);
  const jwks = (await res.json()) as Partial<Jwks>;
  if (!Array.isArray(jwks.keys)) throw new SsoError('malformed JWKS');
  return { keys: jwks.keys };
}

/**
 * Derive the OIDC `nonce` for a request from its `state`, statelessly, via
 * HMAC-SHA256. Re-deriving from `state` in `completeLogin` lets us validate
 * the ID token's nonce without persisting anything between the two calls.
 * Exported for tests.
 */
export async function deriveOidcNonce(secret: string, state: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret) as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`oidc-nonce:${state}`) as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
