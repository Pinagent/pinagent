// SPDX-License-Identifier: Elastic-2.0
import {
  AccessDeniedError,
  issueRelaySessionToken,
  MembershipRequiredError,
  type MembershipStore,
  type Permission,
  type UserId,
} from '@pinagent/ee-auth';
import {
  checkQuota,
  type MeterSink,
  type SubscriptionStore,
  USAGE_KINDS,
} from '@pinagent/ee-billing';
import { AUDIT_ACTIONS, type AuditSink } from '@pinagent/ee-team-features';
import { isoFromSeconds } from './clock';

/**
 * The relay session-issuance endpoint — how the dock and CLI obtain a token
 * to connect to `@pinagent/ee-relay`.
 *
 * Framework-agnostic: it speaks the Web Fetch `Request`/`Response` types, so
 * the same handler drops into a Cloudflare Worker, a Node server
 * (`@hono/node-server` / `node:http` shim), or Bun. All collaborators are
 * injected (`SessionServiceDeps`) so the routing/authorization logic is unit
 * tested without a live server, store, or identity provider.
 *
 *   POST /sessions  { organizationId, sessionId }
 *     → 200 { token, sessionId, relayUrl }
 *     → 401 caller not authenticated
 *     → 400 malformed body
 *     → 403 not an active member / role lacks the required permission
 */

/** The authenticated caller, resolved from the request by an {@link Authenticator}. */
export interface AuthenticatedUser {
  userId: UserId;
}

/**
 * Resolves the caller's identity from the request (SSO cookie, bearer JWT,
 * …). Returns `null` when the request is unauthenticated. The real
 * implementation is backed by `ee-auth`'s SSO surface; see
 * {@link devHeaderAuthenticator} for local development.
 */
export type Authenticator = (request: Request) => Promise<AuthenticatedUser | null>;

export interface SessionServiceDeps {
  /** Membership source of truth — the issuer checks active membership. */
  store: MembershipStore;
  /** Resolves the calling user from the request. */
  authenticate: Authenticator;
  /** HMAC secret shared with the relay (its `RELAY_AUTH_SECRET`). */
  secret: string;
  /** Public relay URL returned to the client so it knows where to connect. */
  relayUrl: string;
  /** Token lifetime in seconds (defaults to the issuer's default). */
  ttlSeconds?: number;
  /**
   * Minimum permission required to obtain a session. Defaults to
   * `conversation:read` — any member can connect; write actions are gated
   * later, per-connection, at the relay.
   */
  requirePermission?: Permission;
  /** Optional audit sink — records session grants and denials when present. */
  audit?: AuditSink;
  /** Optional usage meter — records a billable relay-session unit on success. */
  meter?: MeterSink;
  /**
   * Optional subscription store. When present together with `meter`, session
   * issuance is gated on the org's plan quota (over-limit → 402).
   */
  subscriptions?: SubscriptionStore;
  /** Override the issued-at clock (epoch seconds) — for tests. */
  nowSeconds?: number;
}

interface SessionRequestBody {
  organizationId: string;
  sessionId: string;
}

const MAX_ID_LENGTH = 128;
const DEFAULT_REQUIRED_PERMISSION: Permission = 'conversation:read';

/** Handle `POST /sessions`. */
export async function handleSessionRequest(
  request: Request,
  deps: SessionServiceDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  const user = await deps.authenticate(request);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const body = parseBody(raw);
  if (!body) {
    return json({ error: 'organizationId and sessionId are required' }, 400);
  }

  try {
    const { token, principal } = await issueRelaySessionToken({
      store: deps.store,
      userId: user.userId,
      organizationId: body.organizationId,
      sessionId: body.sessionId,
      secret: deps.secret,
      ttlSeconds: deps.ttlSeconds,
      requirePermission: deps.requirePermission ?? DEFAULT_REQUIRED_PERMISSION,
      nowSeconds: deps.nowSeconds,
    });
    const occurredAt = isoFromSeconds(deps.nowSeconds);

    // Enforce plan quota (membership + RBAC already passed inside `issue`).
    // The token was signed above but isn't delivered when over quota.
    if (deps.subscriptions && deps.meter) {
      const decision = await checkQuota(
        { subscriptions: deps.subscriptions, meter: deps.meter },
        { organizationId: body.organizationId, kind: USAGE_KINDS.relaySession },
      );
      if (!decision.allowed) {
        await deps.audit?.record({
          occurredAt,
          organizationId: body.organizationId,
          actorUserId: user.userId,
          action: AUDIT_ACTIONS.sessionDenied,
          targetId: body.sessionId,
          metadata: {
            reason: 'quota',
            plan: decision.plan.id,
            used: decision.used,
            limit: decision.limit,
          },
        });
        return json({ error: 'plan quota exceeded' }, 402);
      }
    }

    await deps.audit?.record({
      occurredAt,
      organizationId: body.organizationId,
      actorUserId: user.userId,
      action: AUDIT_ACTIONS.sessionIssued,
      targetId: body.sessionId,
      metadata: { role: principal.role },
    });
    await deps.meter?.record({
      occurredAt,
      organizationId: body.organizationId,
      kind: USAGE_KINDS.relaySession,
      quantity: 1,
      metadata: { sessionId: body.sessionId, role: principal.role },
    });
    return json({ token, sessionId: body.sessionId, relayUrl: deps.relayUrl }, 200);
  } catch (err) {
    // Authorization failures are the expected non-2xx outcomes; collapse both
    // to 403 so we don't leak whether the org/user exists.
    if (err instanceof MembershipRequiredError || err instanceof AccessDeniedError) {
      await deps.audit?.record({
        occurredAt: isoFromSeconds(deps.nowSeconds),
        organizationId: body.organizationId,
        actorUserId: user.userId,
        action: AUDIT_ACTIONS.sessionDenied,
        targetId: body.sessionId,
        metadata: { reason: err instanceof AccessDeniedError ? 'permission' : 'membership' },
      });
      return json({ error: 'forbidden' }, 403);
    }
    throw err;
  }
}

/** Route cloud HTTP requests. Currently just the session endpoint. */
export async function handleCloudRequest(
  request: Request,
  deps: SessionServiceDeps,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/sessions') {
    return handleSessionRequest(request, deps);
  }
  return json({ error: 'not found' }, 404);
}

/** Adapt the router into the `{ fetch }` shape Workers and Node servers expect. */
export function createCloudFetch(deps: SessionServiceDeps): {
  fetch(request: Request): Promise<Response>;
} {
  return { fetch: (request) => handleCloudRequest(request, deps) };
}

/**
 * Development-only authenticator that trusts an `X-Pinagent-User` header.
 * NEVER use in production — wire `ee-auth`'s SSO surface instead.
 */
export const devHeaderAuthenticator: Authenticator = async (request) => {
  const userId = request.headers.get('X-Pinagent-User');
  return userId ? { userId } : null;
};

function parseBody(value: unknown): SessionRequestBody | null {
  if (typeof value !== 'object' || value === null) return null;
  const { organizationId, sessionId } = value as Record<string, unknown>;
  if (!isValidId(organizationId) || !isValidId(sessionId)) return null;
  return { organizationId, sessionId };
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
