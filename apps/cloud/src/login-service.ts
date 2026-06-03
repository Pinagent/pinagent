// SPDX-License-Identifier: Elastic-2.0
import {
  type InvitationStore,
  type MembershipStore,
  type SsoConnection,
  type SsoConnectionStore,
  type SsoProvider,
  signUserToken,
  type UserStore,
} from '@pinagent/ee-auth';
import { AUDIT_ACTIONS, type AuditSink } from '@pinagent/ee-team-features';
import { isoFromSeconds } from './clock';
import { signLoginState, verifyLoginState } from './sso-state';

/**
 * The browser-facing SSO login routes that drive the OIDC `SsoProvider`:
 *
 *   GET /sso/start[?connection=id | ?email=user@acme.com][&returnTo=/path]
 *     → resolve the IdP connection (explicit id, email-domain discovery, or
 *       the configured default) → 302 to its authorize URL, carrying a
 *       signed `state` that pins the connection id.
 *   GET /sso/callback?code=…&state=…
 *     → validate state, re-resolve the connection from the store, complete the
 *       OIDC handshake → mint a user token → 302 to `returnTo`, setting the
 *       token in an HttpOnly session cookie.
 *
 * Framework-agnostic (Web `Request`/`Response`), fully injected for testing.
 */

export interface LoginServiceDeps {
  provider: SsoProvider;
  /** The org's configured IdP connections, resolved per request. */
  connections: SsoConnectionStore;
  /**
   * Connection used when the start request names none (single-connection
   * deployments). Omit to require an explicit `?connection=` / `?email=`.
   */
  defaultConnectionId?: string;
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
  /**
   * User store — the callback just-in-time provisions (creates/refreshes) the
   * user behind the IdP profile, resolving the internal synthetic user id from
   * `(connectionId, subject)`, and mints the token with that id. Required so a
   * token never carries the raw IdP subject (which wouldn't match a
   * synthetic-keyed membership).
   */
  users: UserStore;
  /**
   * Optional invitation consumption: when both are wired, a pending invitation
   * matching `(connection org, profile email)` is turned into an active
   * membership and deleted at login. No-op if either is absent; best-effort, so
   * a failure here never fails the login.
   */
  invitations?: InvitationStore;
  memberships?: MembershipStore;
  /** Optional audit sink — records successful logins when present. */
  audit?: AuditSink;
  /**
   * Optional welcome-email notifier (best-effort, opt-in). Sent only on a
   * user's FIRST sign-in. Absent in dev/tests and when no email provider is
   * configured — login works unchanged without it.
   */
  email?: {
    sendWelcome(input: {
      to: string;
      name: string | null;
      organizationName: string | null;
    }): Promise<void>;
  };
  /** Override the clock (epoch seconds) — for tests. */
  nowSeconds?: number;
}

const DEFAULT_USER_TOKEN_TTL_SECONDS = 3_600;

/** GET /sso/start — resolve the connection, then redirect into its IdP. */
export async function handleSsoStart(request: Request, deps: LoginServiceDeps): Promise<Response> {
  if (request.method !== 'GET') return text('method not allowed', 405);
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'), deps.defaultReturnTo);

  const connection = await resolveStartConnection(url, deps);
  if (!connection || !connection.enabled) return text('unknown or disabled connection', 400);

  const state = await signLoginState({ connectionId: connection.id, returnTo }, deps.stateSecret, {
    nowSeconds: deps.nowSeconds,
  });
  const authorizeUrl = await deps.provider.authorizationUrl(connection, state);
  return redirect(authorizeUrl);
}

/**
 * Pick the connection a start request targets: an explicit `?connection=id`,
 * else email-domain discovery via `?email=`, else the configured default.
 * `null` when nothing resolves.
 */
async function resolveStartConnection(
  url: URL,
  deps: LoginServiceDeps,
): Promise<SsoConnection | null> {
  const explicit = url.searchParams.get('connection');
  if (explicit) return deps.connections.get(explicit);

  const email = url.searchParams.get('email');
  const domain = email?.split('@')[1];
  if (domain) return deps.connections.findByDomain(domain);

  if (deps.defaultConnectionId) return deps.connections.get(deps.defaultConnectionId);
  return null;
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
  if (!state.ok) return text('invalid state', 400);

  // Re-resolve the connection the start path pinned into the state. A row that
  // vanished or was disabled between start and callback is treated as invalid.
  const connection = await deps.connections.get(state.claims.connectionId);
  if (!connection || !connection.enabled) return text('invalid state', 400);

  let userToken: string;
  try {
    const profile = await deps.provider.completeLogin(connection, {
      payload: code,
      state: stateParam,
    });
    // Just-in-time provision the user behind this profile, resolving the
    // internal (synthetic) user id from `(connectionId, subject)`. The token +
    // audit carry that id, never the IdP subject.
    const user = await deps.users.provisionFromProfile(profile, {
      now: isoFromSeconds(deps.nowSeconds),
    });
    const userId = user.id;
    userToken = await signUserToken(userId, deps.userTokenSecret, {
      ttlSeconds: deps.userTokenTtlSeconds,
      nowSeconds: deps.nowSeconds,
    });
    await deps.audit?.record({
      occurredAt: isoFromSeconds(deps.nowSeconds),
      organizationId: connection.organizationId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.login,
      metadata: { connectionId: connection.id },
    });
    await consumeInvitation(deps, connection, profile.email, userId);
    await maybeSendWelcome(deps, connection, user);
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

/**
 * Turn a pending invitation for `(connection org, email)` into an active
 * membership and delete it. Best-effort: any failure is swallowed so the login
 * still succeeds (the invitation simply stays pending for the next login).
 */
async function consumeInvitation(
  deps: LoginServiceDeps,
  connection: SsoConnection,
  email: string,
  userId: string,
): Promise<void> {
  const { invitations, memberships } = deps;
  if (!invitations || !memberships) return;
  try {
    const invite = await invitations.get(connection.organizationId, email);
    if (!invite) return;
    const nowIso = isoFromSeconds(deps.nowSeconds);
    await memberships.upsertMembership({
      organizationId: connection.organizationId,
      userId,
      role: invite.role,
      status: 'active',
      invitedAt: invite.invitedAt,
      joinedAt: nowIso,
    });
    await invitations.remove(connection.organizationId, email);
    await deps.audit?.record({
      occurredAt: nowIso,
      organizationId: connection.organizationId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.memberJoined,
      metadata: { email },
    });
  } catch {
    // Non-fatal — login proceeds; the invitation is consumed on a later login.
  }
}

/**
 * Send a welcome email on a user's FIRST sign-in only. First login is when the
 * record was just created — `createdAt === lastLoginAt` (the Pg adapter sets
 * both to `now` on insert and only bumps `lastLoginAt` on re-login). Best-effort
 * and opt-in: no email dep, no recipient address, or not-first-login → no-op;
 * any failure is swallowed so login still succeeds.
 */
async function maybeSendWelcome(
  deps: LoginServiceDeps,
  connection: SsoConnection,
  user: { email: string; displayName: string | null; createdAt: string; lastLoginAt: string },
): Promise<void> {
  if (!deps.email || !user.email || user.createdAt !== user.lastLoginAt) return;
  try {
    const org = await deps.memberships?.getOrganization(connection.organizationId);
    await deps.email.sendWelcome({
      to: user.email,
      name: user.displayName,
      organizationName: org?.displayName ?? null,
    });
  } catch {
    // Best-effort: a welcome email must never fail the login.
  }
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
