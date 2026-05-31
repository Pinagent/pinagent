// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { CloudApiError, createCloudApiClient, UnauthorizedError } from '../src/api-client';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

/** Build a fake fetch that records its calls and returns a canned response. */
function fakeFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown },
) {
  const calls: FetchCall[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const { status = 200, body = {} } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  const first = (): FetchCall => {
    const call = calls[0];
    if (!call) throw new Error('fetch was not called');
    return call;
  };
  return { fetchFn, first };
}

describe('createCloudApiClient', () => {
  it('requests usage with the org id and unwraps the payload', async () => {
    const { fetchFn, first } = fakeFetch(() => ({
      body: { organizationId: 'org_1', usage: { 'relay.session': 42 } },
    }));
    const client = createCloudApiClient({ fetch: fetchFn });

    const usage = await client.getUsage('org_1');

    expect(usage).toEqual({ 'relay.session': 42 });
    expect(first().url).toBe('/usage?organizationId=org_1');
    expect(first().init?.credentials).toBe('include');
  });

  it('honours baseUrl and encodes the org id', async () => {
    const { fetchFn, first } = fakeFetch(() => ({ body: { members: [] } }));
    const client = createCloudApiClient({ baseUrl: 'https://api.example.com/', fetch: fetchFn });

    await client.getMembers('org/with space');

    expect(first().url).toBe('https://api.example.com/members?organizationId=org%2Fwith%20space');
  });

  it('unwraps members, audit, and config payloads', async () => {
    const { fetchFn } = fakeFetch((url) => {
      if (url.startsWith('/members')) return { body: { members: [{ userId: 'u1' }] } };
      if (url.startsWith('/audit')) return { body: { events: [{ id: 'a1' }] } };
      if (url.startsWith('/subscriptions')) return { body: { subscription: { planId: 'pro' } } };
      if (url.startsWith('/cost-controls'))
        return { body: { costControl: { enforcement: 'block' } } };
      if (url.startsWith('/branch-routing'))
        return { body: { branchRouting: { defaultBaseBranch: 'main' } } };
      return { body: {} };
    });
    const client = createCloudApiClient({ fetch: fetchFn });

    expect(await client.getMembers('o')).toEqual([{ userId: 'u1' }]);
    expect(await client.getAudit('o')).toEqual([{ id: 'a1' }]);
    expect(await client.getSubscription('o')).toEqual({ planId: 'pro' });
    expect(await client.getCostControl('o')).toEqual({ enforcement: 'block' });
    expect(await client.getBranchRouting('o')).toEqual({ defaultBaseBranch: 'main' });
  });

  it('appends a limit to the audit query when provided', async () => {
    const { fetchFn, first } = fakeFetch(() => ({ body: { events: [] } }));
    const client = createCloudApiClient({ fetch: fetchFn });

    await client.getAudit('o', { limit: 25 });

    expect(first().url).toBe('/audit?organizationId=o&limit=25');
  });

  it('unwraps /me/orgs to the orgs array (no org param)', async () => {
    const myOrg = {
      organizationId: 'acme',
      displayName: 'Acme',
      slug: 'acme',
      role: 'admin',
      status: 'active',
    };
    const { fetchFn, first } = fakeFetch(() => ({ body: { orgs: [myOrg] } }));
    const client = createCloudApiClient({ fetch: fetchFn });

    expect(await client.getMyOrgs()).toEqual([myOrg]);
    expect(first().url).toBe('/me/orgs');
    expect(first().init?.credentials).toBe('include');
  });

  it('defaults /me/orgs to an empty array when absent', async () => {
    const { fetchFn } = fakeFetch(() => ({ body: {} }));
    const client = createCloudApiClient({ fetch: fetchFn });
    expect(await client.getMyOrgs()).toEqual([]);
  });

  it('defaults absent config payloads to null', async () => {
    const { fetchFn } = fakeFetch(() => ({ body: { organizationId: 'o' } }));
    const client = createCloudApiClient({ fetch: fetchFn });

    expect(await client.getSubscription('o')).toBeNull();
    expect(await client.getCostControl('o')).toBeNull();
    expect(await client.getBranchRouting('o')).toBeNull();
  });

  it('throws UnauthorizedError on 401', async () => {
    const { fetchFn } = fakeFetch(() => ({ status: 401 }));
    const client = createCloudApiClient({ fetch: fetchFn });

    await expect(client.getUsage('o')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws CloudApiError with the status on other failures', async () => {
    const { fetchFn } = fakeFetch(() => ({ status: 500 }));
    const client = createCloudApiClient({ fetch: fetchFn });

    await expect(client.getUsage('o')).rejects.toMatchObject({
      name: 'CloudApiError',
      status: 500,
    });
    await expect(client.getUsage('o')).rejects.toBeInstanceOf(CloudApiError);
  });
});

describe('createCloudApiClient PUT methods', () => {
  it('PUTs cost controls as JSON and unwraps the saved record', async () => {
    const { fetchFn, first } = fakeFetch(() => ({
      body: {
        costControl: { organizationId: 'o', maxRelaySessionsPerPeriod: 5000, enforcement: 'block' },
      },
    }));
    const client = createCloudApiClient({ fetch: fetchFn });

    const saved = await client.putCostControl('o', {
      maxRelaySessionsPerPeriod: 5000,
      enforcement: 'block',
    });

    expect(saved).toMatchObject({ maxRelaySessionsPerPeriod: 5000, enforcement: 'block' });
    const call = first();
    expect(call.url).toBe('/cost-controls?organizationId=o');
    expect(call.init?.method).toBe('PUT');
    expect(call.init?.credentials).toBe('include');
    expect((call.init?.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(call.init?.body))).toEqual({
      maxRelaySessionsPerPeriod: 5000,
      enforcement: 'block',
    });
  });

  it('PUTs a subscription as JSON and unwraps the saved record', async () => {
    const { fetchFn, first } = fakeFetch(() => ({
      body: {
        subscription: { organizationId: 'o', planId: 'pro', currentPeriodStart: '2026-05-01' },
      },
    }));
    const client = createCloudApiClient({ fetch: fetchFn });

    const saved = await client.putSubscription('o', {
      planId: 'pro',
      currentPeriodStart: '2026-05-01',
    });

    expect(saved).toMatchObject({ planId: 'pro', currentPeriodStart: '2026-05-01' });
    const call = first();
    expect(call.url).toBe('/subscriptions?organizationId=o');
    expect(call.init?.method).toBe('PUT');
    expect(JSON.parse(String(call.init?.body))).toEqual({
      planId: 'pro',
      currentPeriodStart: '2026-05-01',
    });
  });

  it('PUTs branch routing as JSON and unwraps the saved record', async () => {
    const { fetchFn, first } = fakeFetch(() => ({
      body: {
        branchRouting: {
          organizationId: 'o',
          defaultBaseBranch: 'main',
          allowedBranchPatterns: ['feat/*'],
        },
      },
    }));
    const client = createCloudApiClient({ fetch: fetchFn });

    const saved = await client.putBranchRouting('o', {
      defaultBaseBranch: 'main',
      allowedBranchPatterns: ['feat/*'],
    });

    expect(saved).toMatchObject({ defaultBaseBranch: 'main', allowedBranchPatterns: ['feat/*'] });
    const call = first();
    expect(call.url).toBe('/branch-routing?organizationId=o');
    expect(call.init?.method).toBe('PUT');
    expect(JSON.parse(String(call.init?.body))).toEqual({
      defaultBaseBranch: 'main',
      allowedBranchPatterns: ['feat/*'],
    });
  });

  it('maps PUT failures to the typed errors', async () => {
    const unauth = createCloudApiClient({ fetch: fakeFetch(() => ({ status: 401 })).fetchFn });
    await expect(
      unauth.putCostControl('o', { maxRelaySessionsPerPeriod: null, enforcement: 'warn' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const forbidden = createCloudApiClient({ fetch: fakeFetch(() => ({ status: 403 })).fetchFn });
    await expect(
      forbidden.putBranchRouting('o', { defaultBaseBranch: null, allowedBranchPatterns: [] }),
    ).rejects.toMatchObject({ name: 'CloudApiError', status: 403 });
  });
});

describe('createCloudApiClient invitations', () => {
  it('unwraps GET /invitations to the array', async () => {
    const inv = {
      organizationId: 'o',
      email: 'a@acme.com',
      role: 'member',
      invitedAt: 'i',
      invitedByUserId: null,
    };
    const { fetchFn, first } = fakeFetch(() => ({ body: { invitations: [inv] } }));
    const client = createCloudApiClient({ fetch: fetchFn });
    expect(await client.getInvitations('o')).toEqual([inv]);
    expect(first().url).toBe('/invitations?organizationId=o');
  });

  it('POSTs an invite as JSON', async () => {
    const { fetchFn, first } = fakeFetch(() => ({ body: {} }));
    const client = createCloudApiClient({ fetch: fetchFn });
    await client.inviteMember('o', { email: 'a@acme.com', role: 'admin' });
    const call = first();
    expect(call.url).toBe('/invitations?organizationId=o');
    expect(call.init?.method).toBe('POST');
    expect(JSON.parse(String(call.init?.body))).toEqual({ email: 'a@acme.com', role: 'admin' });
  });

  it('DELETEs a revoke with the email in the query', async () => {
    const { fetchFn, first } = fakeFetch(() => ({ body: {} }));
    const client = createCloudApiClient({ fetch: fetchFn });
    await client.revokeInvitation('o', 'a b@acme.com');
    const call = first();
    expect(call.url).toBe('/invitations?organizationId=o&email=a%20b%40acme.com');
    expect(call.init?.method).toBe('DELETE');
  });

  it('maps invitation failures to typed errors', async () => {
    const forbidden = createCloudApiClient({ fetch: fakeFetch(() => ({ status: 403 })).fetchFn });
    await expect(
      forbidden.inviteMember('o', { email: 'a@acme.com', role: 'member' }),
    ).rejects.toMatchObject({ name: 'CloudApiError', status: 403 });
    const unauth = createCloudApiClient({ fetch: fakeFetch(() => ({ status: 401 })).fetchFn });
    await expect(unauth.revokeInvitation('o', 'a@acme.com')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe('createCloudApiClient member mutations', () => {
  it('PATCHes a role change with userId in the query', async () => {
    const { fetchFn, first } = fakeFetch(() => ({ body: {} }));
    const client = createCloudApiClient({ fetch: fetchFn });
    await client.changeMemberRole('o', 'usr_a', 'admin');
    const call = first();
    expect(call.url).toBe('/members?organizationId=o&userId=usr_a');
    expect(call.init?.method).toBe('PATCH');
    expect(JSON.parse(String(call.init?.body))).toEqual({ role: 'admin' });
  });

  it('DELETEs a member with userId in the query', async () => {
    const { fetchFn, first } = fakeFetch(() => ({ body: {} }));
    const client = createCloudApiClient({ fetch: fetchFn });
    await client.removeMember('o', 'usr_a');
    const call = first();
    expect(call.url).toBe('/members?organizationId=o&userId=usr_a');
    expect(call.init?.method).toBe('DELETE');
  });

  it('maps a 409 (last-owner) to a typed CloudApiError', async () => {
    const conflict = createCloudApiClient({ fetch: fakeFetch(() => ({ status: 409 })).fetchFn });
    await expect(conflict.changeMemberRole('o', 'usr_a', 'member')).rejects.toMatchObject({
      name: 'CloudApiError',
      status: 409,
    });
  });
});
