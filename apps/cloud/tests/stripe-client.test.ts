// SPDX-License-Identifier: Elastic-2.0
import type { StripeMeterEvent } from '@pinagent/ee-billing';
import { describe, expect, it } from 'vitest';
import { createStripeMeterClient } from '../src/stripe-client';

const event: StripeMeterEvent = {
  eventName: 'relay_sessions',
  customerId: 'cus_123',
  value: 7,
  identifier: 'acme:2026-04-01T00:00:00.000Z',
  timestamp: '2026-05-01T00:00:00.000Z',
};

/** Capture the single fetch call and reply with a configurable response. */
function captureFetch(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('createStripeMeterClient', () => {
  it('POSTs a form-encoded meter event with auth + idempotency headers', async () => {
    const { calls, fetchImpl } = captureFetch(new Response('{}', { status: 200 }));
    const client = createStripeMeterClient('sk_test_abc', {
      fetch: fetchImpl,
      baseUrl: 'https://stripe.test',
    });

    await client.recordMeterEvent(event);

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe('https://stripe.test/v1/billing/meter_events');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test_abc');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(headers['Idempotency-Key']).toBe('acme:2026-04-01T00:00:00.000Z');

    const body = new URLSearchParams(init.body as string);
    expect(body.get('event_name')).toBe('relay_sessions');
    expect(body.get('identifier')).toBe('acme:2026-04-01T00:00:00.000Z');
    expect(body.get('payload[stripe_customer_id]')).toBe('cus_123');
    expect(body.get('payload[value]')).toBe('7');
    // timestamp is unix seconds for 2026-05-01T00:00:00Z
    expect(body.get('timestamp')).toBe(String(Date.parse('2026-05-01T00:00:00.000Z') / 1000));
  });

  it('throws on a non-2xx Stripe response', async () => {
    const { fetchImpl } = captureFetch(
      new Response('{"error":{"message":"no such customer"}}', { status: 400 }),
    );
    const client = createStripeMeterClient('sk_test_abc', { fetch: fetchImpl });
    await expect(client.recordMeterEvent(event)).rejects.toThrow(
      /Stripe meter event failed \(400\)/,
    );
  });
});
