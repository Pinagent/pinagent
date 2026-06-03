// SPDX-License-Identifier: Elastic-2.0
import type { Subscription } from '@pinagent/ee-billing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SubscriptionForm } from '../src/SubscriptionForm';

const noop = async () => {};

describe('SubscriptionForm initial render', () => {
  it('pre-selects the current plan and pre-fills the period start', () => {
    const initial: Subscription = {
      organizationId: 'o',
      planId: 'pro',
      currentPeriodStart: '2026-05-01T00:00:00.000Z',
    };
    const html = renderToStaticMarkup(
      <SubscriptionForm initial={initial} onSubmit={noop} onCancel={() => {}} />,
    );
    expect(html).toMatch(/<option value="pro"[^>]*selected/);
    expect(html).toContain('value="2026-05-01T00:00:00.000Z"');
    // only self-serviceable plans are offered; privileged enterprise is not
    expect(html).toContain('Free');
    expect(html).toContain('Pro');
    expect(html).not.toContain('Enterprise');
    expect(html).not.toContain('value="enterprise"');
    expect(html).toContain('Save');
  });

  it('defaults to the first plan and a blank period for a null subscription', () => {
    const html = renderToStaticMarkup(
      <SubscriptionForm initial={null} onSubmit={noop} onCancel={() => {}} />,
    );
    expect(html).toMatch(/<option value="free"[^>]*selected/);
    expect(html).toContain('value=""');
  });
});
