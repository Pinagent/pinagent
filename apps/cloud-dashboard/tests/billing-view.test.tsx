// SPDX-License-Identifier: Elastic-2.0
import type { Subscription } from '@pinagent/ee-billing';
import type { CostControl } from '@pinagent/ee-team-features';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BillingView } from '../src/Billing';

const subscription = (over: Partial<Subscription> = {}): Subscription => ({
  organizationId: 'org_1',
  planId: 'pro',
  currentPeriodStart: '2026-05-01T00:00:00.000Z',
  ...over,
});

const costControl = (over: Partial<CostControl> = {}): CostControl => ({
  organizationId: 'org_1',
  maxRelaySessionsPerPeriod: 5000,
  enforcement: 'block',
  ...over,
});

describe('BillingView', () => {
  it('renders the plan name, period, and quota for a known plan', () => {
    const html = renderToStaticMarkup(
      BillingView({ subscription: subscription({ planId: 'pro' }), costControl: costControl() }),
    );
    expect(html).toContain('Pro'); // plan name resolved from planId
    expect(html).toContain('2026-05-01T00:00:00.000Z');
    expect(html).toContain('10,000'); // pro plan's included relay.session quota
    expect(html).toContain('5,000'); // cost-control cap
    expect(html).toContain('Block over cap');
  });

  it('falls back to the raw planId for an unknown plan and unlimited quota', () => {
    const html = renderToStaticMarkup(
      BillingView({ subscription: subscription({ planId: 'custom-xyz' }), costControl: null }),
    );
    expect(html).toContain('custom-xyz');
    expect(html).toContain('Unlimited');
    expect(html).toContain('No cost controls configured.');
  });

  it('shows the default-plan empty state when there is no subscription', () => {
    const html = renderToStaticMarkup(BillingView({ subscription: null, costControl: null }));
    expect(html).toContain('default plan');
  });

  it('shows "No cap" / "Warn only" for an unbounded warn policy', () => {
    const html = renderToStaticMarkup(
      BillingView({
        subscription: null,
        costControl: costControl({ maxRelaySessionsPerPeriod: null, enforcement: 'warn' }),
      }),
    );
    expect(html).toContain('No cap');
    expect(html).toContain('Warn only');
  });
});
