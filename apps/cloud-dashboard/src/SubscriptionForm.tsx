// SPDX-License-Identifier: Elastic-2.0
'use client';

import { PLANS, type Subscription } from '@pinagent/ee-billing';
import { Button } from '@pinagent/ui/components/ui/button';
import { Input } from '@pinagent/ui/components/ui/input';
import { type FormEvent, useState } from 'react';
import type { SubscriptionInput } from './api-client';
import { Field, FormError, selectClassName } from './form-controls';
import { parseSubscriptionForm } from './forms';

// Only self-serviceable plans are offered — privileged plans (e.g. unlimited
// `enterprise`) are internal-only and the server 403s a self-assign attempt.
const PLAN_OPTIONS = Object.values(PLANS).filter((plan) => plan.selfServiceable);

/**
 * Edit form for the org's subscription. Validation lives in
 * `parseSubscriptionForm`; this wires inputs to it. On a successful `onSubmit`
 * the parent unmounts the form.
 */
export function SubscriptionForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: Subscription | null;
  onSubmit: (input: SubscriptionInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [planId, setPlanId] = useState(initial?.planId ?? PLAN_OPTIONS[0]?.id ?? 'free');
  const [currentPeriodStart, setCurrentPeriodStart] = useState(initial?.currentPeriodStart ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseSubscriptionForm({ planId, currentPeriodStart });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit(parsed.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <Field label="Plan">
        <select
          className={selectClassName}
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
        >
          {PLAN_OPTIONS.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Billing period start">
        <Input
          type="text"
          placeholder="2026-01-01T00:00:00.000Z"
          value={currentPeriodStart}
          onChange={(e) => setCurrentPeriodStart(e.target.value)}
        />
      </Field>
      <FormError error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
