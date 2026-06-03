// SPDX-License-Identifier: Elastic-2.0
import { signSessionToken } from '@pinagent/ee-auth';
import { beforeEach, describe, expect, it } from 'vitest';
import { relayDoName } from '../src/do-name';
import worker, { type Env } from '../src/worker';

const SECRET = 'test-relay-secret';

/**
 * Fake DurableObjectNamespace that records every name routed through it and
 * echoes the resolved DO name + the forwarded (token-derived) headers back on
 * the response, so a test can assert WHICH Durable Object a request reached.
 */
function fakeNamespace() {
  const names: string[] = [];
  const ns = {
    idFromName(name: string) {
      return { name } as unknown as DurableObjectId;
    },
    get(id: DurableObjectId) {
      const name = (id as unknown as { name: string }).name;
      names.push(name);
      return {
        async fetch(req: Request) {
          // The DO name carries a NUL separator (invalid in a header value), so
          // echo it in the body; forwarded token-derived values go in headers.
          return new Response(name, {
            headers: {
              'x-fwd-tenant': req.headers.get('X-Pinagent-Tenant') ?? '',
              'x-fwd-session': req.headers.get('X-Pinagent-Session') ?? '',
              'x-fwd-role': req.headers.get('X-Pinagent-Member-Role') ?? '',
            },
          });
        },
      } as unknown as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
  return { ns, names };
}

function env(over: Partial<Env> = {}): { env: Env; names: string[] } {
  const { ns, names } = fakeNamespace();
  return { env: { RELAY: ns, RELAY_AUTH_SECRET: SECRET, ...over }, names };
}

async function wsRequest(token: string, query = '') {
  return new Request(`https://relay.test/__pinagent/ws${query}`, {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${token}` },
  });
}

describe('relay worker — Durable Object routing', () => {
  let tokenA: string; // client token, org-a/sess-1
  let tokenB: string; // client token, org-b/sess-1
  let deviceA: string; // device token, org-a/sess-1

  beforeEach(async () => {
    // Same sessionId, two different tenants — the cross-tenant collision case.
    tokenA = await signSessionToken(
      { tenantId: 'org-a', sessionId: 'sess-1', role: 'member', audience: 'client' },
      SECRET,
    );
    tokenB = await signSessionToken(
      { tenantId: 'org-b', sessionId: 'sess-1', role: 'member', audience: 'client' },
      SECRET,
    );
    deviceA = await signSessionToken(
      { tenantId: 'org-a', sessionId: 'sess-1', role: 'member', audience: 'device' },
      SECRET,
    );
  });

  it('routes the same sessionId in two tenants to DIFFERENT Durable Objects', async () => {
    const { env: e, names } = env();
    const resA = await worker.fetch(await wsRequest(tokenA), e);
    const resB = await worker.fetch(await wsRequest(tokenB), e);

    expect(await resA.text()).toBe(relayDoName('org-a', 'sess-1'));
    expect(await resB.text()).toBe(relayDoName('org-b', 'sess-1'));
    expect(names[0]).not.toBe(names[1]); // no collision
  });

  it('co-locates the same tenant + session (device + client share a DO)', async () => {
    const { env: e } = env();
    const device = new Request('https://relay.test/__pinagent/device', {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${deviceA}` },
    });
    const client = await wsRequest(tokenA);
    const dRes = await worker.fetch(device, e);
    const cRes = await worker.fetch(client, e);
    expect(await dRes.text()).toBe(await cRes.text());
  });

  it('rejects a CLIENT token presented at the device endpoint (no impersonation)', async () => {
    const { env: e, names } = env();
    const req = new Request('https://relay.test/__pinagent/device', {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${tokenA}` },
    });
    const res = await worker.fetch(req, e);
    expect(res.status).toBe(401);
    expect(names).toHaveLength(0); // never reaches a Durable Object
  });

  it('rejects a DEVICE token presented at the client endpoint', async () => {
    const { env: e, names } = env();
    const res = await worker.fetch(await wsRequest(deviceA), e);
    expect(res.status).toBe(401);
    expect(names).toHaveLength(0);
  });

  it('uses the token claims, not a spoofed header or ?session= query', async () => {
    const { env: e } = env();
    // Attacker supplies headers + query for org-b/sess-evil; the token says org-a/sess-1.
    const req = new Request('https://relay.test/__pinagent/ws?session=sess-evil', {
      headers: {
        Upgrade: 'websocket',
        Authorization: `Bearer ${tokenA}`,
        'X-Pinagent-Tenant': 'org-b',
        'X-Pinagent-Session': 'sess-evil',
      },
    });
    const res = await worker.fetch(req, e);
    expect(await res.text()).toBe(relayDoName('org-a', 'sess-1'));
    expect(res.headers.get('x-fwd-tenant')).toBe('org-a');
    expect(res.headers.get('x-fwd-session')).toBe('sess-1');
  });

  it('401s an invalid token and never reaches a Durable Object', async () => {
    const { env: e, names } = env();
    const res = await worker.fetch(await wsRequest('garbage'), e);
    expect(res.status).toBe(401);
    expect(names).toHaveLength(0);
  });

  it('dev-fallback keys the DO by ?session= ONLY when insecure is opted in', async () => {
    const { env: e } = env({ RELAY_AUTH_SECRET: undefined, RELAY_ALLOW_INSECURE: 'true' });
    const req = new Request('https://relay.test/__pinagent/ws?session=local-1', {
      headers: { Upgrade: 'websocket', Authorization: 'Bearer any-nonempty' },
    });
    const res = await worker.fetch(req, e);
    expect(await res.text()).toBe(relayDoName('local-1', 'local-1'));
  });

  it('fails CLOSED (500) with no auth secret and no insecure opt-in', async () => {
    const { env: e, names } = env({ RELAY_AUTH_SECRET: undefined });
    const req = new Request('https://relay.test/__pinagent/ws?session=local-1', {
      headers: { Upgrade: 'websocket', Authorization: 'Bearer any-nonempty' },
    });
    const res = await worker.fetch(req, e);
    expect(res.status).toBe(500);
    expect(names).toHaveLength(0); // never reaches a Durable Object
  });

  it('treats a non-truthy RELAY_ALLOW_INSECURE as off (still fails closed)', async () => {
    const { env: e } = env({ RELAY_AUTH_SECRET: undefined, RELAY_ALLOW_INSECURE: 'false' });
    const req = new Request('https://relay.test/__pinagent/ws?session=local-1', {
      headers: { Upgrade: 'websocket', Authorization: 'Bearer any-nonempty' },
    });
    const res = await worker.fetch(req, e);
    expect(res.status).toBe(500);
  });
});

describe('relay worker — internal push routing', () => {
  function pushRequest(query: string, secret = SECRET) {
    return new Request(`https://relay.test/__pinagent/internal/push${query}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'set_branch_routing' }),
    });
  }

  it('routes to the tenant-scoped DO matching the WS device socket', async () => {
    const { env: e } = env({ RELAY_INTERNAL_SECRET: SECRET });
    const res = await worker.fetch(pushRequest('?tenant=org-a&session=sess-1'), e);
    expect(await res.text()).toBe(relayDoName('org-a', 'sess-1'));
  });

  it('400s when the tenant is missing (would otherwise hit the wrong DO)', async () => {
    const { env: e } = env({ RELAY_INTERNAL_SECRET: SECRET });
    const res = await worker.fetch(pushRequest('?session=sess-1'), e);
    expect(res.status).toBe(400);
  });

  it('503s when the internal secret is unset (endpoint disabled, fails closed)', async () => {
    const { env: e } = env({ RELAY_INTERNAL_SECRET: undefined });
    const res = await worker.fetch(pushRequest('?tenant=org-a&session=sess-1'), e);
    expect(res.status).toBe(503);
  });

  it('401s on a bad internal bearer secret', async () => {
    const { env: e } = env({ RELAY_INTERNAL_SECRET: SECRET });
    const res = await worker.fetch(pushRequest('?tenant=org-a&session=sess-1', 'wrong'), e);
    expect(res.status).toBe(401);
  });
});
