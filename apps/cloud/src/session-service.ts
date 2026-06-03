// SPDX-License-Identifier: Elastic-2.0
import {
  AccessDeniedError,
  issueRelaySessionToken,
  MembershipRequiredError,
  type MembershipStore,
  type Permission,
  type UserId,
  type UserStore,
} from '@pinagent/ee-auth';
import {
  checkQuota,
  type IssuanceLock,
  type MeterSink,
  type SubscriptionStore,
  USAGE_KINDS,
  type UsageAlertSeverity,
  type UsageAlertStore,
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
  /**
   * Optional usage-cap alerting. All three together enable a best-effort email
   * to the org's admins/owners when a cost cap is hit (`blocked`) or approached
   * (`warning`): `users` resolves their addresses, `usageAlerts` throttles to
   * once per period, and `email` sends. The send runs OUTSIDE the issuance lock
   * (see {@link handleSessionRequest}); absent any of them, it's a no-op.
   */
  users?: UserStore;
  usageAlerts?: UsageAlertStore;
  email?: {
    sendUsageAlert(input: {
      to: string;
      organizationName: string;
      resource: string;
      used: number;
      limit: number | null;
      severity: UsageAlertSeverity;
    }): Promise<void>;
  };
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
  /**
   * Worker `ctx.waitUntil`, when available — used to fire a usage-cap alert
   * email AFTER the response, off the issuance lock. Absent (tests / non-Worker
   * hosts) → the alert is awaited inline instead (still off-lock).
   */
  waitUntil?: (promise: Promise<unknown>) => void,
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
      // `/sessions` issues client-side tokens (browsers/docks joining a session).
      // The dev machine's device token is provisioned out of band as `device`.
      audience: 'client',
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
    const { denial, alert } = deps.issuanceLock
      ? await deps.issuanceLock.withLock(body.organizationId, critical)
      : await critical();

    // Fire the usage-cap alert (if any) OFF the lock: in the background via
    // `waitUntil` so the response isn't delayed by email I/O, or awaited inline
    // when no `waitUntil` is available. The closure is best-effort + throttled.
    if (alert) {
      if (waitUntil) waitUntil(alert());
      else await alert();
    }

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
/**
 * Result of the gate: a `denial` Response to return (402) when blocked, or null
 * to proceed; plus an optional `alert` — a best-effort usage-cap email task to
 * run OUTSIDE the lock (set on a cost-cap block OR warning). Building the task
 * here (under the lock) captures the decision; the I/O happens off-lock.
 */
interface GateResult {
  denial: Response | null;
  alert: (() => Promise<void>) | null;
}

async function enforceQuotaAndMeter(
  deps: SessionServiceDeps,
  body: SessionRequestBody,
  actorUserId: UserId,
  role: string,
  occurredAt: string,
): Promise<GateResult> {
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
      return { denial: json({ error: 'plan quota exceeded' }, 402), alert: null };
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
        const alert = makeUsageAlert(deps, {
          organizationId: body.organizationId,
          severity: decision.allowed ? 'warning' : 'blocked',
          used: decision.used,
          limit: decision.cap,
          periodStart: periodStart ?? '',
        });
        // Blocked: reject (token not delivered). Warning: allow + fall through
        // to meter, carrying the alert.
        if (!decision.allowed) return { denial: json({ error: 'cost cap reached' }, 402), alert };
        return { ...(await meterAndIssue(deps, body, actorUserId, role, occurredAt)), alert };
      }
    }
  }

  return meterAndIssue(deps, body, actorUserId, role, occurredAt);
}

/** Audit the grant + meter one relay-session unit. Always allows (denial null). */
async function meterAndIssue(
  deps: SessionServiceDeps,
  body: SessionRequestBody,
  actorUserId: UserId,
  role: string,
  occurredAt: string,
): Promise<GateResult> {
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
  return { denial: null, alert: null };
}

/**
 * Build a best-effort usage-cap alert task, or null when alerting isn't fully
 * wired. The returned closure (run off the lock) throttles via `usageAlerts`
 * (≤ one email per org/period/severity), resolves the org's active
 * admins/owners + their addresses, and emails each. All failures swallowed —
 * an alert must never affect issuance.
 */
function makeUsageAlert(
  deps: SessionServiceDeps,
  input: {
    organizationId: string;
    severity: UsageAlertSeverity;
    used: number;
    limit: number | null;
    periodStart: string;
  },
): (() => Promise<void>) | null {
  const { email, users, usageAlerts, store } = deps;
  if (!email || !users || !usageAlerts) return null;
  const { organizationId, severity, used, limit, periodStart } = input;
  return async () => {
    try {
      // Throttle: only the first claim of (org, period, severity) sends.
      if (!(await usageAlerts.claim({ organizationId, periodStart, severity }))) return;
      const [org, members] = await Promise.all([
        store.getOrganization(organizationId),
        store.listMembers(organizationId),
      ]);
      const admins = members.filter(
        (m) => m.status === 'active' && (m.role === 'admin' || m.role === 'owner'),
      );
      const addresses = await Promise.all(
        admins.map(async (m) => (await users.get(m.userId))?.email),
      );
      const recipients = [...new Set(addresses.filter((e): e is string => Boolean(e)))];
      await Promise.all(
        recipients.map((to) =>
          email.sendUsageAlert({
            to,
            organizationName: org?.displayName ?? organizationId,
            resource: 'relay sessions',
            used,
            limit,
            severity,
          }),
        ),
      );
    } catch {
      // Best-effort: a usage alert must never affect issuance.
    }
  };
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
