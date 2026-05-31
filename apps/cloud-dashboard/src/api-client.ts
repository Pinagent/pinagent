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

/** One organization the caller belongs to (GET /me/orgs), for the switcher. */
export interface MyOrg {
  organizationId: string;
  displayName: string;
  slug: string | null;
  role: string;
  status: string;
}

/** A member (GET /members) — the membership enriched with the user's identity. */
export interface Member extends OrganizationMembership {
  email: string | null;
  displayName: string | null;
}

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

/** A pending invitation (GET /invitations). */
export interface Invitation {
  organizationId: string;
  email: string;
  role: string;
  invitedAt: string;
  invitedByUserId: string | null;
}

/** POST /invitations body. */
export interface MemberInviteInput {
  email: string;
  role: string;
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
  /** The caller's own organizations (not org-scoped). */
  getMyOrgs(): Promise<MyOrg[]>;
  getUsage(organizationId: string): Promise<UsageSummary>;
  getMembers(organizationId: string): Promise<Member[]>;
  changeMemberRole(organizationId: string, userId: string, role: string): Promise<void>;
  removeMember(organizationId: string, userId: string): Promise<void>;
  getInvitations(organizationId: string): Promise<Invitation[]>;
  inviteMember(organizationId: string, input: MemberInviteInput): Promise<void>;
  revokeInvitation(organizationId: string, email: string): Promise<void>;
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

  async function post(path: string, body: unknown): Promise<void> {
    const res = await fetchFn(`${base}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new CloudApiError(res.status, `POST ${path} failed (${res.status})`);
  }

  async function patch(path: string, body: unknown): Promise<void> {
    const res = await fetchFn(`${base}${path}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new CloudApiError(res.status, `PATCH ${path} failed (${res.status})`);
  }

  async function del(path: string): Promise<void> {
    const res = await fetchFn(`${base}${path}`, { method: 'DELETE', credentials: 'include' });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new CloudApiError(res.status, `DELETE ${path} failed (${res.status})`);
  }

  const orgQuery = (organizationId: string) =>
    `?organizationId=${encodeURIComponent(organizationId)}`;

  return {
    getMyOrgs: () => get('/me/orgs', (b) => (b.orgs as MyOrg[]) ?? []),
    getUsage: (org) => get(`/usage${orgQuery(org)}`, (b) => (b.usage as UsageSummary) ?? {}),
    getMembers: (org) => get(`/members${orgQuery(org)}`, (b) => (b.members as Member[]) ?? []),
    changeMemberRole: (org, userId, role) =>
      patch(`/members${orgQuery(org)}&userId=${encodeURIComponent(userId)}`, { role }),
    removeMember: (org, userId) =>
      del(`/members${orgQuery(org)}&userId=${encodeURIComponent(userId)}`),
    getInvitations: (org) =>
      get(`/invitations${orgQuery(org)}`, (b) => (b.invitations as Invitation[]) ?? []),
    inviteMember: (org, input) => post(`/invitations${orgQuery(org)}`, input),
    revokeInvitation: (org, email) =>
      del(`/invitations${orgQuery(org)}&email=${encodeURIComponent(email)}`),
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
