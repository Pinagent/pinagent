// SPDX-License-Identifier: Elastic-2.0
import type { MeterSink } from './metering';
import { PLANS, type Plan, planById, quotaFor, wouldExceedQuota } from './plans';

/**
 * Per-organization plan assignment + the quota-enforcement decision.
 *
 * `checkQuota` is the gate the control plane consults before granting more of
 * a metered resource: it resolves the org's plan, sums usage since the current
 * billing period, and reports whether one more unit fits. Pure orchestration
 * over the `SubscriptionStore` + `MeterSink` ports — the Postgres adapters and
 * the enforcement wiring live in the cloud app.
 */

export interface Subscription {
  organizationId: string;
  planId: string;
  /** ISO-8601 start of the current billing period — usage is counted from here. */
  currentPeriodStart: string;
  /**
   * The org's Stripe customer id, when billed through Stripe. Set by
   * provisioning (not by the org-facing config endpoint); the billing reporter
   * keys meter events off it. `null`/absent → the org isn't reported to Stripe.
   */
  stripeCustomerId?: string | null;
}

/** A page of subscriptions, keyed by `organizationId` for {@link SubscriptionStore.listPage}. */
export interface SubscriptionPageOptions {
  /** Return only `organizationId > after` (exclusive); omit for the first page. */
  after?: string;
  /** Max rows to return. */
  limit: number;
}

export interface SubscriptionStore {
  get(organizationId: string): Promise<Subscription | null>;
  /**
   * One keyset page of subscriptions ordered by `organizationId` (ascending),
   * for `organizationId > after`. The billing-period rollover walks the whole
   * table in bounded pages instead of loading every row at once. Keyset (not
   * offset) is safe because rollover only mutates `currentPeriodStart`, never
   * the `organizationId` it pages on — so no row is skipped or seen twice.
   */
  listPage(opts: SubscriptionPageOptions): Promise<Subscription[]>;
  upsert(subscription: Subscription): Promise<void>;
}

/** The plan an org falls back to when it has no subscription row. */
export const DEFAULT_PLAN: Plan = PLANS.free;

export interface QuotaDecision {
  allowed: boolean;
  plan: Plan;
  kind: string;
  used: number;
  /** `null` = unlimited. */
  limit: number | null;
}

/**
 * Decide whether `organizationId` may record `additional` (default 1) more of
 * `kind`, given its plan and usage so far this period. Orgs with no
 * subscription, or an unknown plan id, fall back to {@link DEFAULT_PLAN}.
 */
export async function checkQuota(
  deps: { subscriptions: SubscriptionStore; meter: MeterSink },
  input: { organizationId: string; kind: string; additional?: number },
): Promise<QuotaDecision> {
  const subscription = await deps.subscriptions.get(input.organizationId);
  const plan = (subscription && planById(subscription.planId)) || DEFAULT_PLAN;
  const usage = await deps.meter.summarize({
    organizationId: input.organizationId,
    since: subscription?.currentPeriodStart,
  });
  const used = usage[input.kind] ?? 0;
  return {
    allowed: !wouldExceedQuota(plan, input.kind, used, input.additional ?? 1),
    plan,
    kind: input.kind,
    used,
    limit: quotaFor(plan, input.kind),
  };
}

/** In-memory subscription store for tests/dev. */
export function createInMemorySubscriptionStore(seed: Subscription[] = []): SubscriptionStore {
  const byOrg = new Map<string, Subscription>(seed.map((s) => [s.organizationId, s]));
  return {
    async get(organizationId: string): Promise<Subscription | null> {
      return byOrg.get(organizationId) ?? null;
    },
    async listPage({ after, limit }: SubscriptionPageOptions): Promise<Subscription[]> {
      const ordered = [...byOrg.values()].sort((a, b) =>
        a.organizationId < b.organizationId ? -1 : a.organizationId > b.organizationId ? 1 : 0,
      );
      const tail = after === undefined ? ordered : ordered.filter((s) => s.organizationId > after);
      return tail.slice(0, limit);
    },
    async upsert(subscription: Subscription): Promise<void> {
      byOrg.set(subscription.organizationId, subscription);
    },
  };
}
