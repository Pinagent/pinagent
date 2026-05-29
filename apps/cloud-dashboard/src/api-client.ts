// SPDX-License-Identifier: Elastic-2.0
import type { OrganizationMembership } from '@pinagent/ee-auth';
import type { Subscription, UsageSummary } from '@pinagent/ee-billing';
import type { AuditEvent, BranchRoutingPolicy, CostControl } from '@pinagent/ee-team-features';

/**
 * Typed client for the cloud control-plane API (the `apps/cloud` Worker).
 * Browser-side: calls carry the session cookie (`credentials: 'include'`) set
 * by the `/sso` login flow. Read-only for now (the dashboard's first cut);
 * config mutations (PUT) are a follow-up.
 */

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
  };
}
