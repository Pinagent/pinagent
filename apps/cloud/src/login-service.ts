// SPDX-License-Identifier: Elastic-2.0
import { type SsoConnection, type SsoProvider, signUserToken } from '@pinagent/ee-auth';
import { signLoginState, verifyLoginState } from './sso-state';

/**
 * The browser-facing SSO login routes that drive the OIDC `SsoProvider`:
 *
 *   GET /sso/start[?returnTo=/path]
 *     → 302 to the IdP authorize URL, carrying a signed `state`.
 *   GET /sso/callback?code=…&state=…
 *     → validate state + complete the OIDC handshake → mint a user token →
 *       302 to `returnTo`, setting the token in an HttpOnly session cookie.
 *
 * Framework-agnostic (Web `Request`/`Response`), fully injected for testing.
 */

export interface LoginServiceDeps {
  provider: SsoProvider;
  /** The configured connection this deployment logs users into. */
  connection: SsoConnection;
  /** HMAC secret for the signed login `state`. */
  stateSecret: string;
  /** HMAC secret for minting the user-identity token. */
  userTokenSecret: string;
  /** User-token lifetime, seconds (cookie Max-Age matches). */
  userTokenTtlSeconds?: number;
  /** Cookie name the user token is stored in. */
  cookieName: string;
  /** Fallback post-login redirect when the request gives no `returnTo`. */
  defaultReturnTo: string;
  /** Override the clock (epoch seconds) — for tests. */
  nowSeconds?: number;
}

const DEFAULT_USER_TOKEN_TTL_SECONDS = 3_600;

/** GET /sso/start — redirect into the IdP. */
export async function handleSsoStart(request: Request, deps: LoginServiceDeps): Promise<Response> {
  if (request.method !== 'GET') return text('method not allowed', 405);
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'), deps.defaultReturnTo);

  const state = await signLoginState(
    { connectionId: deps.connection.id, returnTo },
    deps.stateSecret,
    { nowSeconds: deps.nowSeconds },
  );
  const authorizeUrl = await deps.provider.authorizationUrl(deps.connection, state);
  return redirect(authorizeUrl);
}

/** GET /sso/callback — complete the handshake and establish a session. */
export async function handleSsoCallback(
  request: Request,
  deps: LoginServiceDeps,
): Promise<Response> {
  if (request.method !== 'GET') return text('method not allowed', 405);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  if (!code || !stateParam) return text('missing code or state', 400);

  const state = await verifyLoginState(stateParam, deps.stateSecret, {
    nowSeconds: deps.nowSeconds,
  });
  if (!state.ok || state.claims.connectionId !== deps.connection.id) {
    return text('invalid state', 400);
  }

  let userToken: string;
  try {
    const profile = await deps.provider.completeLogin(deps.connection, {
      payload: code,
      state: stateParam,
    });
    // TODO: map the IdP subject to an internal user (JIT provisioning); for now
    // the subject *is* the user id, which is what memberships are keyed on.
    userToken = await signUserToken(profile.subject, deps.userTokenSecret, {
      ttlSeconds: deps.userTokenTtlSeconds,
      nowSeconds: deps.nowSeconds,
    });
  } catch {
    // Generic — never leak why the IdP handshake failed to the browser.
    return text('login failed', 401);
  }

  const maxAge = deps.userTokenTtlSeconds ?? DEFAULT_USER_TOKEN_TTL_SECONDS;
  return new Response(null, {
    status: 302,
    headers: {
      location: safeReturnTo(state.claims.returnTo, deps.defaultReturnTo),
      'set-cookie': sessionCookie(deps.cookieName, userToken, maxAge),
    },
  });
}

/** Only allow same-origin path redirects, to prevent open-redirect abuse. */
function safeReturnTo(value: string | null, fallback: string): string {
  if (value?.startsWith('/') && !value.startsWith('//')) return value;
  return fallback;
}

function sessionCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}
