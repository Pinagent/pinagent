// SPDX-License-Identifier: Elastic-2.0

import { planById, quotaFor, type Subscription, USAGE_KINDS } from '@pinagent/ee-billing';
import type { CostControl } from '@pinagent/ee-team-features';
import { useState } from 'react';
import type { CloudApiClient } from './api-client';
import { UnauthorizedError } from './api-client';
import { CostControlForm } from './CostControlForm';
import { SignIn } from './SignIn';
import { useAsync } from './use-async';

export interface BillingData {
  subscription: Subscription | null;
  costControl: CostControl | null;
}

function SubscriptionSection({ subscription }: { subscription: Subscription | null }) {
  if (!subscription) {
    return (
      <p className="empty">No active subscription — the organization is on the default plan.</p>
    );
  }
  const plan = planById(subscription.planId);
  const sessionQuota = plan ? quotaFor(plan, USAGE_KINDS.relaySession) : null;
  return (
    <dl className="kv">
      <div className="kv-row">
        <dt>Plan</dt>
        <dd>{plan?.name ?? subscription.planId}</dd>
      </div>
      <div className="kv-row">
        <dt>Billing period start</dt>
        <dd>{subscription.currentPeriodStart}</dd>
      </div>
      <div className="kv-row">
        <dt>Included relay sessions</dt>
        <dd>{sessionQuota === null ? 'Unlimited' : sessionQuota.toLocaleString()}</dd>
      </div>
    </dl>
  );
}

function CostControlsSection({ costControl }: { costControl: CostControl | null }) {
  if (!costControl) {
    return <p className="empty">No cost controls configured.</p>;
  }
  const { maxRelaySessionsPerPeriod, enforcement } = costControl;
  return (
    <dl className="kv">
      <div className="kv-row">
        <dt>Max relay sessions / period</dt>
        <dd>
          {maxRelaySessionsPerPeriod === null
            ? 'No cap'
            : maxRelaySessionsPerPeriod.toLocaleString()}
        </dd>
      </div>
      <div className="kv-row">
        <dt>Enforcement</dt>
        <dd>{enforcement === 'block' ? 'Block over cap' : 'Warn only'}</dd>
      </div>
    </dl>
  );
}

/** Pure, render-only view — exercised directly in tests via renderToStaticMarkup. */
export function BillingView({ subscription, costControl }: BillingData) {
  return (
    <section className="panel">
      <h2>Billing</h2>
      <h3>Subscription</h3>
      <SubscriptionSection subscription={subscription} />
      <h3>Cost controls</h3>
      <CostControlsSection costControl={costControl} />
    </section>
  );
}

/** Data-loading container. */
export function Billing({
  client,
  organizationId,
}: {
  client: CloudApiClient;
  organizationId: string;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);

  const state = useAsync<BillingData>(async () => {
    const [subscription, costControl] = await Promise.all([
      client.getSubscription(organizationId),
      client.getCostControl(organizationId),
    ]);
    return { subscription, costControl };
  }, [client, organizationId, reloadKey]);

  if (state.status === 'loading') return <p className="loading">Loading…</p>;
  if (state.status === 'error') {
    if (state.error instanceof UnauthorizedError) return <SignIn />;
    return (
      <p className="error" role="alert">
        Failed to load billing: {String(state.error)}
      </p>
    );
  }

  if (editing) {
    return (
      <section className="panel">
        <h2>Billing</h2>
        <h3>Edit cost controls</h3>
        <CostControlForm
          initial={state.value.costControl}
          onSubmit={async (input) => {
            await client.putCostControl(organizationId, input);
            setEditing(false);
            setReloadKey((k) => k + 1);
          }}
          onCancel={() => setEditing(false)}
        />
      </section>
    );
  }

  return (
    <>
      <BillingView subscription={state.value.subscription} costControl={state.value.costControl} />
      <div className="panel-actions">
        <button type="button" onClick={() => setEditing(true)}>
          Edit cost controls
        </button>
      </div>
    </>
  );
}
