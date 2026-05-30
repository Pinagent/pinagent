// SPDX-License-Identifier: Elastic-2.0
import type { OrganizationMembership } from '@pinagent/ee-auth';
import type { Subscription, UsageSummary } from '@pinagent/ee-billing';
import type {
  AuditEvent,
  BranchRoutingPolicy,
  CostControl,
  CostControlEnforcement,
} from '@pinagent/ee-team-features';

/**
 * Typed client for the cloud control-plane API (the `apps/cloud` Worker).
 * Browser-side: calls carry the session cookie (`credentials: 'include'`) set
 * by the `/sso` login flow.
 */

/** PUT /subscriptions body (org-id is taken from the query, not the body). */
export interface SubscriptionInput {
  planId: string;
  currentPeriodStart: string;
}

/** PUT /cost-controls body (org-id is taken from the query, not the body). */
export interface CostControlInput {
  maxRelaySessionsPerPeriod: number | null;
  enforcement: CostControlEnforcement;
}

/** PUT /branch-routing body. */
export interface BranchRoutingInput {
  defaultBaseBranch: string | null;
  allowedBranchPatterns: string[];
}

export class CloudApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CloudApiError';
  }
}

/** Thrown on a 401 so the UI can route to sign-in. */
export class UnauthorizedError extends CloudApiError {
  constructor() {
    super(401, 'not authenticated');
    this.name = 'UnauthorizedError';
  }
}

export interface CloudApiClient {
  getUsage(organizationId: string): Promise<UsageSummary>;
  getMembers(organizationId: string): Promise<OrganizationMembership[]>;
  getAudit(organizationId: string, opts?: { limit?: number }): Promise<AuditEvent[]>;
  getSubscription(organizationId: string): Promise<Subscription | null>;
  getCostControl(organizationId: string): Promise<CostControl | null>;
  getBranchRouting(organizationId: string): Promise<BranchRoutingPolicy | null>;
  putSubscription(organizationId: string, input: SubscriptionInput): Promise<Subscription>;
  putCostControl(organizationId: string, input: CostControlInput): Promise<CostControl>;
  putBranchRouting(organizationId: string, input: BranchRoutingInput): Promise<BranchRoutingPolicy>;
}

export interface CloudApiClientOptions {
  /** API origin; defaults to `''` (same-origin, via the dev proxy / prod host). */
  baseUrl?: string;
  /** Injectable fetch for tests. */
  fetch?: typeof fetch;
}

export function createCloudApiClient(options: CloudApiClientOptions = {}): CloudApiClient {
  const base = (options.baseUrl ?? '').replace(/\/+$/, '');
  const fetchFn: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function get<T>(path: string, pick: (body: Record<string, unknown>) => T): Promise<T> {
    const res = await fetchFn(`${base}${path}`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new CloudApiError(res.status, `GET ${path} failed (${res.status})`);
    const body = (await res.json()) as Record<string, unknown>;
    return pick(body);
  }

  async function put<T>(
    path: string,
    body: unknown,
    pick: (body: Record<string, unknown>) => T,
  ): Promise<T> {
    const res = await fetchFn(`${base}${path}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new CloudApiError(res.status, `PUT ${path} failed (${res.status})`);
    const payload = (await res.json()) as Record<string, unknown>;
    return pick(payload);
  }

  const orgQuery = (organizationId: string) =>
    `?organizationId=${encodeURIComponent(organizationId)}`;

  return {
    getUsage: (org) => get(`/usage${orgQuery(org)}`, (b) => (b.usage as UsageSummary) ?? {}),
    getMembers: (org) =>
      get(`/members${orgQuery(org)}`, (b) => (b.members as OrganizationMembership[]) ?? []),
    getAudit: (org, opts) =>
      get(
        `/audit${orgQuery(org)}${opts?.limit ? `&limit=${opts.limit}` : ''}`,
        (b) => (b.events as AuditEvent[]) ?? [],
      ),
    getSubscription: (org) =>
      get(`/subscriptions${orgQuery(org)}`, (b) => (b.subscription as Subscription | null) ?? null),
    getCostControl: (org) =>
      get(`/cost-controls${orgQuery(org)}`, (b) => (b.costControl as CostControl | null) ?? null),
    getBranchRouting: (org) =>
      get(
        `/branch-routing${orgQuery(org)}`,
        (b) => (b.branchRouting as BranchRoutingPolicy | null) ?? null,
      ),
    putSubscription: (org, input) =>
      put(`/subscriptions${orgQuery(org)}`, input, (b) => b.subscription as Subscription),
    putCostControl: (org, input) =>
      put(`/cost-controls${orgQuery(org)}`, input, (b) => b.costControl as CostControl),
    putBranchRouting: (org, input) =>
      put(`/branch-routing${orgQuery(org)}`, input, (b) => b.branchRouting as BranchRoutingPolicy),
  };
}
