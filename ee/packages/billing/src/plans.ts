// SPDX-License-Identifier: Elastic-2.0
import type { UsageSummary } from './metering';

/**
 * Plan catalog + quota logic. Pure: given a plan and a {@link UsageSummary},
 * compute what's used vs included and whether any limit is exceeded. The
 * eventual enforcement point (deny issuance over quota) and Stripe price
 * mapping build on this; for now it's the read model.
 */

export interface Plan {
  id: string;
  name: string;
  /**
   * Included usage per billing period, by usage kind. A kind absent from the
   * map means unlimited.
   */
  limits: Record<string, number>;
}

export const PLANS = {
  free: { id: 'free', name: 'Free', limits: { 'relay.session': 100 } },
  pro: { id: 'pro', name: 'Pro', limits: { 'relay.session': 10_000 } },
  enterprise: { id: 'enterprise', name: 'Enterprise', limits: {} },
} as const satisfies Record<string, Plan>;

export type PlanId = keyof typeof PLANS;

export function planById(id: string): Plan | null {
  return (PLANS as Record<string, Plan>)[id] ?? null;
}

/** Included quota for a kind on a plan, or `null` when unlimited. */
export function quotaFor(plan: Plan, kind: string): number | null {
  return plan.limits[kind] ?? null;
}

/** True when recording `additional` more of `kind` would exceed the plan. */
export function wouldExceedQuota(plan: Plan, kind: string, used: number, additional = 1): boolean {
  const limit = quotaFor(plan, kind);
  return limit !== null && used + additional > limit;
}

export interface QuotaLine {
  kind: string;
  used: number;
  /** `null` = unlimited. */
  limit: number | null;
  exceeded: boolean;
}

/** Per-kind quota status for a plan against current usage totals. */
export function quotaStatus(plan: Plan, usage: UsageSummary): QuotaLine[] {
  const kinds = new Set([...Object.keys(plan.limits), ...Object.keys(usage)]);
  return [...kinds].map((kind) => {
    const used = usage[kind] ?? 0;
    const limit = quotaFor(plan, kind);
    return { kind, used, limit, exceeded: limit !== null && used > limit };
  });
}
