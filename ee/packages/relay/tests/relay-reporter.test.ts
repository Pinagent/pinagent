// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it, vi } from 'vitest';
import type { RelayLifecycleEvent } from '../src/relay-events';
import { createRelayReporter, relayReporterConfigFromEnv } from '../src/relay-reporter';

const event: RelayLifecycleEvent = {
  type: 'client.connected',
  organizationId: 'acme',
  sessionId: 'sess-1',
  occurredAt: '2026-05-29T00:00:00Z',
};

describe('createRelayReporter', () => {
  it('POSTs the event batch with bearer auth', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    const reporter = createRelayReporter(
      { ingestUrl: 'https://cloud.test/internal/relay/events', secret: 'shh' },
      fetchFn,
    );
    await reporter.report(event);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cloud.test/internal/relay/events');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer shh');
    expect(JSON.parse(init.body as string)).toEqual({ events: [event] });
  });

  it('is a no-op when config is null (reporting disabled)', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }));
    await createRelayReporter(null, fetchFn).report(event);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('swallows network errors (best-effort)', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    const reporter = createRelayReporter(
      { ingestUrl: 'https://cloud.test/internal/relay/events', secret: 'shh' },
      fetchFn,
    );
    await expect(reporter.report(event)).resolves.toBeUndefined();
  });
});

describe('relayReporterConfigFromEnv', () => {
  it('builds the ingest URL when both vars are set', () => {
    expect(
      relayReporterConfigFromEnv({
        PINAGENT_CONTROL_PLANE_URL: 'https://cloud.test/',
        RELAY_INTERNAL_SECRET: 'shh',
      }),
    ).toEqual({ ingestUrl: 'https://cloud.test/internal/relay/events', secret: 'shh' });
  });

  it('returns null when either var is missing', () => {
    expect(relayReporterConfigFromEnv({ RELAY_INTERNAL_SECRET: 'shh' })).toBeNull();
    expect(relayReporterConfigFromEnv({ PINAGENT_CONTROL_PLANE_URL: 'https://x' })).toBeNull();
    expect(relayReporterConfigFromEnv({})).toBeNull();
  });
});
