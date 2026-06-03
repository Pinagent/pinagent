// SPDX-License-Identifier: Elastic-2.0
import {
  AccessDeniedError,
  authorizeOrgMember,
  MembershipRequiredError,
  type MembershipStore,
  type Permission,
} from '@pinagent/ee-auth';
import { isSelfServiceablePlan, planById, type SubscriptionStore } from '@pinagent/ee-billing';
import type { ActiveSessionRegistry } from '@pinagent/ee-relay';
import type {
  BranchRoutingStore,
  CostControlEnforcement,
  CostControlStore,
} from '@pinagent/ee-team-features';
import type { RelayPushClient } from './relay-client';
import type { Authenticator } from './session-service';

/**
 * Admin configuration endpoints — read + write the org governance stores that
 * were, until now, only settable out-of-band:
 *
 *   GET  /subscriptions   → billing:read    → current plan + period
 *   PUT  /subscriptions   → billing:manage  → set plan + period
 *   GET  /cost-controls   → org:settings    → current cost cap
 *   PUT  /cost-controls   → org:settings    → set cost cap
 *   GET  /branch-routing  → org:settings    → current branch policy
 *   PUT  /branch-routing  → org:settings    → set branch policy
 *
 * All org-scoped (`?organizationId=`) and RBAC-gated via `authorizeOrgMember`.
 * Framework-agnostic (Web `Request`/`Response`), fully injected for testing.
 */
export interface ConfigServiceDeps {
  store: MembershipStore;
  authenticate: Authenticator;
  subscriptions: SubscriptionStore;
  costControls: CostControlStore;
  branchRouting: BranchRoutingStore;
  /**
   * Optional live-propagation pair. When both are present, a branch-routing
   * change is pushed to the org's currently-connected device sessions so it
   * takes effect without waiting for a reconnect. Best-effort: a failed push
   * never fails the PUT (the policy is already persisted, and a reconnecting
   * device re-reads it).
   */
  activeSessions?: ActiveSessionRegistry;
  relay?: RelayPushClient;
}

/** GET/PUT /subscriptions. */
export async function handleSubscriptionConfig(
  request: Request,
  deps: ConfigServiceDeps,
): Promise<Response> {
  if (request.method === 'GET') {
    const ctx = await authorize(request, deps, 'billing:read');
    if ('denied' in ctx) return ctx.denied;
    const subscription = await deps.subscriptions.get(ctx.organizationId);
    return json({ organizationId: ctx.organizationId, subscription }, 200);
  }
  if (request.method === 'PUT') {
    const ctx = await authorize(request, deps, 'billing:manage');
    if ('denied' in ctx) return ctx.denied;
    const body = await readJson(request);
    if (body === undefined) return json({ error: 'invalid JSON body' }, 400);
    const parsed = parseSubscriptionBody(body);
    if (!parsed) return json({ error: 'planId and currentPeriodStart are required' }, 400);
    if (!planById(parsed.planId)) return json({ error: `unknown plan "${parsed.planId}"` }, 400);
    // An admin (billing:manage) may only self-assign self-serviceable plans.
    // Privileged plans (e.g. unlimited `enterprise`) are internal-only — set by
    // provisioning, never by the org itself — so this can't be used to escalate
    // to unlimited quota.
    if (!isSelfServiceablePlan(parsed.planId)) {
      return json({ error: `plan "${parsed.planId}" is not self-serviceable` }, 403);
    }
    const subscription = { organizationId: ctx.organizationId, ...parsed };
    await deps.subscriptions.upsert(subscription);
    return json({ organizationId: ctx.organizationId, subscription }, 200);
  }
  return json({ error: 'method not allowed' }, 405);
}

/** GET/PUT /cost-controls. */
export async function handleCostControlConfig(
  request: Request,
  deps: ConfigServiceDeps,
): Promise<Response> {
  if (request.method === 'GET') {
    const ctx = await authorize(request, deps, 'org:settings');
    if ('denied' in ctx) return ctx.denied;
    const costControl = await deps.costControls.get(ctx.organizationId);
    return json({ organizationId: ctx.organizationId, costControl }, 200);
  }
  if (request.method === 'PUT') {
    const ctx = await authorize(request, deps, 'org:settings');
    if ('denied' in ctx) return ctx.denied;
    const body = await readJson(request);
    if (body === undefined) return json({ error: 'invalid JSON body' }, 400);
    const parsed = parseCostControlBody(body);
    if (!parsed) {
      return json(
        { error: 'maxRelaySessionsPerPeriod (int|null) and enforcement are required' },
        400,
      );
    }
    const costControl = { organizationId: ctx.organizationId, ...parsed };
    await deps.costControls.upsert(costControl);
    return json({ organizationId: ctx.organizationId, costControl }, 200);
  }
  return json({ error: 'method not allowed' }, 405);
}

/** GET/PUT /branch-routing. */
export async function handleBranchRoutingConfig(
  request: Request,
  deps: ConfigServiceDeps,
): Promise<Response> {
  if (request.method === 'GET') {
    const ctx = await authorize(request, deps, 'org:settings');
    if ('denied' in ctx) return ctx.denied;
    const branchRouting = await deps.branchRouting.get(ctx.organizationId);
    return json({ organizationId: ctx.organizationId, branchRouting }, 200);
  }
  if (request.method === 'PUT') {
    const ctx = await authorize(request, deps, 'org:settings');
    if ('denied' in ctx) return ctx.denied;
    const body = await readJson(request);
    if (body === undefined) return json({ error: 'invalid JSON body' }, 400);
    const parsed = parseBranchRoutingBody(body);
    if (!parsed) {
      return json(
        {
          error:
            'defaultBaseBranch (string|null) and allowedBranchPatterns (string[]) are required',
        },
        400,
      );
    }
    const branchRouting = { organizationId: ctx.organizationId, ...parsed };
    await deps.branchRouting.upsert(branchRouting);
    await propagateBranchRouting(deps, ctx.organizationId, parsed);
    return json({ organizationId: ctx.organizationId, branchRouting }, 200);
  }
  return json({ error: 'method not allowed' }, 405);
}

/**
 * Best-effort live propagation of a branch-routing change to the org's
 * connected device sessions. Sends a `set_branch_routing` frame (the
 * agent-runner's inbound ClientMessage) to each currently-connected session.
 * Swallows all failures — the policy is already persisted, so a disconnected
 * machine picks it up on its next connect; this only accelerates the common
 * "device is connected right now" case. No-op unless both the registry and a
 * relay client are wired (they aren't in unit tests that don't need push).
 */
async function propagateBranchRouting(
  deps: ConfigServiceDeps,
  organizationId: string,
  policy: { defaultBaseBranch: string | null; allowedBranchPatterns: string[] },
): Promise<void> {
  const { activeSessions, relay } = deps;
  if (!activeSessions || !relay) return;
  const frame = {
    type: 'set_branch_routing',
    defaultBaseBranch: policy.defaultBaseBranch,
    allowedBranchPatterns: policy.allowedBranchPatterns,
  };
  try {
    const sessions = await activeSessions.listByOrg(organizationId);
    await Promise.all(sessions.map((s) => relay.pushToSession(organizationId, s.sessionId, frame)));
  } catch {
    // Listing failed — non-fatal; the PUT already succeeded. (Per-session push
    // failures are already swallowed inside the client.)
  }
}

type AuthorizeResult = { denied: Response } | { organizationId: string };

async function authorize(
  request: Request,
  deps: ConfigServiceDeps,
  permission: Permission,
): Promise<AuthorizeResult> {
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (!organizationId) return { denied: json({ error: 'organizationId is required' }, 400) };
  const user = await deps.authenticate(request);
  if (!user) return { denied: json({ error: 'unauthorized' }, 401) };
  try {
    await authorizeOrgMember(deps.store, user.userId, organizationId, permission);
  } catch (err) {
    if (err instanceof MembershipRequiredError || err instanceof AccessDeniedError) {
      return { denied: json({ error: 'forbidden' }, 403) };
    }
    throw err;
  }
  return { organizationId };
}

function parseSubscriptionBody(
  value: unknown,
): { planId: string; currentPeriodStart: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { planId, currentPeriodStart } = value as Record<string, unknown>;
  if (typeof planId !== 'string' || planId.length === 0) return null;
  if (typeof currentPeriodStart !== 'string' || currentPeriodStart.length === 0) return null;
  return { planId, currentPeriodStart };
}

function parseCostControlBody(
  value: unknown,
): { maxRelaySessionsPerPeriod: number | null; enforcement: CostControlEnforcement } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { maxRelaySessionsPerPeriod, enforcement } = value as Record<string, unknown>;
  const capOk =
    maxRelaySessionsPerPeriod === null ||
    (typeof maxRelaySessionsPerPeriod === 'number' &&
      Number.isInteger(maxRelaySessionsPerPeriod) &&
      maxRelaySessionsPerPeriod >= 0);
  if (!capOk) return null;
  if (enforcement !== 'block' && enforcement !== 'warn') return null;
  return { maxRelaySessionsPerPeriod: maxRelaySessionsPerPeriod as number | null, enforcement };
}

function parseBranchRoutingBody(
  value: unknown,
): { defaultBaseBranch: string | null; allowedBranchPatterns: string[] } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { defaultBaseBranch, allowedBranchPatterns } = value as Record<string, unknown>;
  if (defaultBaseBranch !== null && typeof defaultBaseBranch !== 'string') return null;
  if (!Array.isArray(allowedBranchPatterns)) return null;
  if (!allowedBranchPatterns.every((p) => typeof p === 'string' && p.length > 0)) return null;
  return { defaultBaseBranch, allowedBranchPatterns: allowedBranchPatterns as string[] };
}

/** Parse a JSON body; `undefined` signals malformed JSON. */
async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
