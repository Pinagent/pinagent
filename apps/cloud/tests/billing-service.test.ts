// SPDX-License-Identifier: Elastic-2.0
import {
  type BillingReporter,
  createInMemorySubscriptionStore,
  type PeriodRolloverEvent,
  type Subscription,
} from '@pinagent/ee-billing';
import { AUDIT_ACTIONS, createInMemoryAuditSink } from '@pinagent/ee-team-features';
import { describe, expect, it } from 'vitest';
import {
  type BillingServiceDeps,
  handleBillingRoll,
  runBillingRollover,
} from '../src/billing-service';

const NOW = '2026-03-01T00:00:00.000Z';
const SECRET = 'internal-secret';

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    organizationId: 'acme',
    planId: 'pro',
    currentPeriodStart: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function recordingReporter(): { reporter: BillingReporter; reports: PeriodRolloverEvent[] } {
  const reports: PeriodRolloverEvent[] = [];
  return {
    reports,
    reporter: {
      async reportPeriodRollover(e) {
        reports.push(e);
      },
    },
  };
}

function deps(subs: Subscription[]): BillingServiceDeps & {
  subscriptions: ReturnType<typeof createInMemorySubscriptionStore>;
  reports: PeriodRolloverEvent[];
  audit: ReturnType<typeof createInMemoryAuditSink>;
} {
  const subscriptions = createInMemorySubscriptionStore(subs);
  const { reporter, reports } = recordingReporter();
  const audit = createInMemoryAuditSink();
  return { subscriptions, reporter, reports, audit, now: () => NOW, internalSecret: SECRET };
}

describe('runBillingRollover', () => {
  it('advances only elapsed subscriptions, upserting the new period start', async () => {
    const d = deps([
      sub({ organizationId: 'stale', currentPeriodStart: '2026-01-01T00:00:00.000Z' }),
      sub({ organizationId: 'fresh', currentPeriodStart: '2026-02-20T00:00:00.000Z' }),
    ]);
    const result = await runBillingRollover(d);

    expect(result).toEqual({ rolled: 1 });
    // 2026-01-01 + 30d = 2026-01-31
    expect((await d.subscriptions.get('stale'))?.currentPeriodStart).toBe(
      '2026-01-31T00:00:00.000Z',
    );
    expect((await d.subscriptions.get('fresh'))?.currentPeriodStart).toBe(
      '2026-02-20T00:00:00.000Z',
    );
  });

  it('reports each rollover and audits it', async () => {
    const d = deps([sub({ organizationId: 'stale' })]);
    await runBillingRollover(d);

    expect(d.reports).toEqual([
      {
        organizationId: 'stale',
        planId: 'pro',
        previousPeriodStart: '2026-01-01T00:00:00.000Z',
        newPeriodStart: '2026-01-31T00:00:00.000Z',
      },
    ]);
    expect(d.audit.events).toEqual([
      expect.objectContaining({ organizationId: 'stale', action: AUDIT_ACTIONS.periodRolled }),
    ]);
  });

  it('does nothing when no period has elapsed', async () => {
    const d = deps([sub({ currentPeriodStart: '2026-02-28T00:00:00.000Z' })]);
    expect(await runBillingRollover(d)).toEqual({ rolled: 0 });
    expect(d.reports).toHaveLength(0);
    expect(d.audit.events).toHaveLength(0);
  });

  it('continues the batch when a report fails (best-effort)', async () => {
    const subscriptions = createInMemorySubscriptionStore([sub({ organizationId: 'stale' })]);
    const reporter: BillingReporter = {
      async reportPeriodRollover() {
        throw new Error('stripe down');
      },
    };
    const result = await runBillingRollover({ subscriptions, reporter, now: () => NOW });
    // the period still advanced despite the report throwing
    expect(result).toEqual({ rolled: 1 });
    expect((await subscriptions.get('stale'))?.currentPeriodStart).toBe('2026-01-31T00:00:00.000Z');
  });

  it('rolls subscriptions spanning multiple keyset pages', async () => {
    // pageSize 2 over 3 elapsed orgs forces a second page; if the loop stopped
    // after page one only 'a' and 'b' would roll.
    const d = deps([
      sub({ organizationId: 'a' }),
      sub({ organizationId: 'b' }),
      sub({ organizationId: 'c' }),
    ]);
    expect(await runBillingRollover({ ...d, pageSize: 2 })).toEqual({ rolled: 3 });
    for (const org of ['a', 'b', 'c']) {
      expect((await d.subscriptions.get(org))?.currentPeriodStart).toBe('2026-01-31T00:00:00.000Z');
    }
  });
});

describe('POST /internal/billing/roll', () => {
  function req(method: string, auth?: string): Request {
    return new Request('https://cloud.test/internal/billing/roll', {
      method,
      headers: auth ? { authorization: auth } : {},
    });
  }

  it('runs the rollover with a valid secret and returns the count', async () => {
    const d = deps([sub({ organizationId: 'stale' })]);
    const res = await handleBillingRoll(req('POST', `Bearer ${SECRET}`), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rolled: 1 });
  });

  it('401s on a missing or wrong secret', async () => {
    const d = deps([]);
    expect((await handleBillingRoll(req('POST'), d)).status).toBe(401);
    expect((await handleBillingRoll(req('POST', 'Bearer nope'), d)).status).toBe(401);
  });

  it('405s on a non-POST method', async () => {
    expect((await handleBillingRoll(req('GET', `Bearer ${SECRET}`), deps([]))).status).toBe(405);
  });
});
