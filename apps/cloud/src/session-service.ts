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
  type IssuanceLock,
  type MeterSink,
  type SubscriptionStore,
  USAGE_KINDS,
} from '@pinagent/ee-billing';
import {
  AUDIT_ACTIONS,
  type AuditSink,
  type CostControlStore,
  evaluateCostControl,
} from '@pinagent/ee-team-features';
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
  /**
   * Optional org-set cost controls. When present with `meter`, issuance over an
   * org's configured cap is blocked (402) or warned (audited but allowed),
   * independent of the plan quota.
   */
  costControls?: CostControlStore;
  /**
   * Optional per-org issuance lock. When present, the quota + cost-cap gate and
   * the metered write run under an exclusive per-org lock so concurrent
   * issuances for the same org can't both pass the cap (a read-modify-write
   * race). No-op effect on correctness when absent — just unserialized.
   */
  issuanceLock?: IssuanceLock;
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

    // The quota + cost-cap gate is a read-modify-write over usage (read totals →
    // decide → record one unit). Run it — and the metered write — under an
    // exclusive per-org lock when one is configured, so two concurrent
    // issuances for the same org can't both read the same total, both pass the
    // cap, and both record (overshooting the limit). Without a lock it's
    // unserialized (the prior behaviour); the gate logic is unchanged.
    const critical = () =>
      enforceQuotaAndMeter(deps, body, user.userId, principal.role, occurredAt);
    const denial = deps.issuanceLock
      ? await deps.issuanceLock.withLock(body.organizationId, critical)
      : await critical();
    if (denial) return denial;

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

/**
 * The quota + cost-cap enforcement and the metered write, as one unit so an
 * {@link IssuanceLock} can serialize it per org. Returns a denial `Response` to
 * send back (402), or `null` when issuance is allowed — in which case the
 * session has been audited and one unit metered. Reads usage, decides, then
 * records: keep this whole sequence inside the lock so the read and the write
 * are atomic with respect to other issuances for the same org.
 */
async function enforceQuotaAndMeter(
  deps: SessionServiceDeps,
  body: SessionRequestBody,
  actorUserId: UserId,
  role: string,
  occurredAt: string,
): Promise<Response | null> {
  // Enforce plan quota (membership + RBAC already passed inside `issue`).
  // The token was signed already but isn't delivered when over quota.
  if (deps.subscriptions && deps.meter) {
    const decision = await checkQuota(
      { subscriptions: deps.subscriptions, meter: deps.meter },
      { organizationId: body.organizationId, kind: USAGE_KINDS.relaySession },
    );
    if (!decision.allowed) {
      await deps.audit?.record({
        occurredAt,
        organizationId: body.organizationId,
        actorUserId,
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

  // Org-set cost control: a self-imposed cap, independent of the plan quota.
  // `block` rejects over-cap; `warn` allows but records a warning.
  if (deps.costControls && deps.meter) {
    const control = await deps.costControls.get(body.organizationId);
    if (control) {
      const periodStart = deps.subscriptions
        ? (await deps.subscriptions.get(body.organizationId))?.currentPeriodStart
        : undefined;
      const usage = await deps.meter.summarize({
        organizationId: body.organizationId,
        since: periodStart,
      });
      const decision = evaluateCostControl(control, usage[USAGE_KINDS.relaySession] ?? 0);
      if (decision.overCap) {
        await deps.audit?.record({
          occurredAt,
          organizationId: body.organizationId,
          actorUserId,
          action: decision.allowed ? AUDIT_ACTIONS.costCapWarning : AUDIT_ACTIONS.costCapBlocked,
          targetId: body.sessionId,
          metadata: { cap: decision.cap, used: decision.used, enforcement: decision.enforcement },
        });
        if (!decision.allowed) return json({ error: 'cost cap reached' }, 402);
      }
    }
  }

  await deps.audit?.record({
    occurredAt,
    organizationId: body.organizationId,
    actorUserId,
    action: AUDIT_ACTIONS.sessionIssued,
    targetId: body.sessionId,
    metadata: { role },
  });
  await deps.meter?.record({
    occurredAt,
    organizationId: body.organizationId,
    kind: USAGE_KINDS.relaySession,
    quantity: 1,
    metadata: { sessionId: body.sessionId, role },
  });
  return null;
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
