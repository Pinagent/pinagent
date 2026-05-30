// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { createRelayClient } from '../src/relay-client';

type Call = { url: string; init: RequestInit | undefined };

function recordingFetch(status: number): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ delivered: status === 200 }), { status });
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

describe('createRelayClient', () => {
  it('POSTs the frame to the internal push endpoint with the bearer secret', async () => {
    const { fetch, calls } = recordingFetch(200);
    const client = createRelayClient({ baseUrl: 'wss://relay.test', secret: 's3cret', fetch });

    const frame = {
      type: 'set_branch_routing',
      defaultBaseBranch: 'main',
      allowedBranchPatterns: [],
    };
    const delivered = await client.pushToSession('sess-1', frame);

    expect(delivered).toBe(true);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    // wss:// is normalized to https:// for the fetch.
    expect(call?.url).toBe('https://relay.test/__pinagent/internal/push?session=sess-1');
    expect(call?.init?.method).toBe('POST');
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer s3cret');
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(call?.init?.body as string)).toEqual(frame);
  });

  it('maps ws:// to http:// and strips a trailing slash', async () => {
    const { fetch, calls } = recordingFetch(200);
    const client = createRelayClient({ baseUrl: 'ws://localhost:8787/', secret: 'x', fetch });
    await client.pushToSession('s', {});
    expect(calls[0]?.url).toBe('http://localhost:8787/__pinagent/internal/push?session=s');
  });

  it('url-encodes the session id', async () => {
    const { fetch, calls } = recordingFetch(200);
    const client = createRelayClient({ baseUrl: 'https://relay.test', secret: 'x', fetch });
    await client.pushToSession('a/b c', {});
    expect(calls[0]?.url).toContain('session=a%2Fb%20c');
  });

  it('returns false when no device is connected (404)', async () => {
    const { fetch } = recordingFetch(404);
    const client = createRelayClient({ baseUrl: 'wss://relay.test', secret: 'x', fetch });
    expect(await client.pushToSession('s', {})).toBe(false);
  });

  it('returns false (never throws) when the fetch rejects', async () => {
    const fetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createRelayClient({ baseUrl: 'wss://relay.test', secret: 'x', fetch });
    expect(await client.pushToSession('s', {})).toBe(false);
  });
});
