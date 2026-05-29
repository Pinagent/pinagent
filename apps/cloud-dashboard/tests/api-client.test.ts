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
