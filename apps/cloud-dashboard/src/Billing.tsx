// SPDX-License-Identifier: Elastic-2.0

import { planById, quotaFor, type Subscription, USAGE_KINDS } from '@pinagent/ee-billing';
import type { CostControl } from '@pinagent/ee-team-features';
import { Button } from '@pinagent/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@pinagent/ui/components/ui/card';
import { useState } from 'react';
import type { CloudApiClient } from './api-client';
import { UnauthorizedError } from './api-client';
import { CostControlForm } from './CostControlForm';
import { formatDate } from './format';
import { KeyValue, type Row } from './KeyValue';
import { SignIn } from './SignIn';
import { SubscriptionForm } from './SubscriptionForm';
import { LoadError, Loading } from './states';
import { useAsync } from './use-async';

type EditMode = 'none' | 'subscription' | 'costControl';

export interface BillingData {
  subscription: Subscription | null;
  costControl: CostControl | null;
}

function subscriptionRows(subscription: Subscription): Row[] {
  const plan = planById(subscription.planId);
  const sessionQuota = plan ? quotaFor(plan, USAGE_KINDS.relaySession) : null;
  return [
    { label: 'Plan', value: plan?.name ?? subscription.planId },
    { label: 'Billing period start', value: formatDate(subscription.currentPeriodStart) },
    {
      label: 'Included relay sessions',
      value: sessionQuota === null ? 'Unlimited' : sessionQuota.toLocaleString(),
    },
  ];
}

function SubscriptionSection({ subscription }: { subscription: Subscription | null }) {
  if (!subscription) {
    return (
      <p className="text-sm text-muted-foreground">
        No active subscription — the organization is on the default plan.
      </p>
    );
  }
  return <KeyValue rows={subscriptionRows(subscription)} />;
}

function CostControlsSection({ costControl }: { costControl: CostControl | null }) {
  if (!costControl) {
    return <p className="text-sm text-muted-foreground">No cost controls configured.</p>;
  }
  const { maxRelaySessionsPerPeriod, enforcement } = costControl;
  return (
    <KeyValue
      rows={[
        {
          label: 'Max relay sessions / period',
          value:
            maxRelaySessionsPerPeriod === null
              ? 'No cap'
              : maxRelaySessionsPerPeriod.toLocaleString(),
        },
        { label: 'Enforcement', value: enforcement === 'block' ? 'Block over cap' : 'Warn only' },
      ]}
    />
  );
}

/** Pure, render-only view — exercised directly in tests via renderToStaticMarkup. */
export function BillingView({ subscription, costControl }: BillingData) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <SubscriptionSection subscription={subscription} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cost controls</CardTitle>
        </CardHeader>
        <CardContent>
          <CostControlsSection costControl={costControl} />
        </CardContent>
      </Card>
    </div>
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
  const [editing, setEditing] = useState<EditMode>('none');

  const state = useAsync<BillingData>(async () => {
    const [subscription, costControl] = await Promise.all([
      client.getSubscription(organizationId),
      client.getCostControl(organizationId),
    ]);
    return { subscription, costControl };
  }, [client, organizationId, reloadKey]);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    if (state.error instanceof UnauthorizedError) return <SignIn />;
    return <LoadError label="billing" error={state.error} />;
  }

  const done = () => {
    setEditing('none');
    setReloadKey((k) => k + 1);
  };

  if (editing === 'subscription') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Edit plan</CardTitle>
        </CardHeader>
        <CardContent>
          <SubscriptionForm
            initial={state.value.subscription}
            onSubmit={async (input) => {
              await client.putSubscription(organizationId, input);
              done();
            }}
            onCancel={() => setEditing('none')}
          />
        </CardContent>
      </Card>
    );
  }

  if (editing === 'costControl') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Edit cost controls</CardTitle>
        </CardHeader>
        <CardContent>
          <CostControlForm
            initial={state.value.costControl}
            onSubmit={async (input) => {
              await client.putCostControl(organizationId, input);
              done();
            }}
            onCancel={() => setEditing('none')}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BillingView subscription={state.value.subscription} costControl={state.value.costControl} />
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setEditing('subscription')}>
          Edit plan
        </Button>
        <Button variant="outline" onClick={() => setEditing('costControl')}>
          Edit cost controls
        </Button>
      </div>
    </div>
  );
}
