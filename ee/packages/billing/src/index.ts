// SPDX-License-Identifier: Elastic-2.0
export const PACKAGE_NAME = '@pinagent/ee-billing';

export { advanceElapsedPeriods, nextPeriodStart, type PeriodRoll } from './billing-period';
export {
  createInMemoryMeterSink,
  type MeterSink,
  USAGE_KINDS,
  type UsageEvent,
  type UsageQuery,
  type UsageSummary,
} from './metering';
export {
  PLANS,
  type Plan,
  type PlanId,
  planById,
  type QuotaLine,
  quotaFor,
  quotaStatus,
  wouldExceedQuota,
} from './plans';
export {
  type BillingReporter,
  noopBillingReporter,
  type PeriodRolloverEvent,
} from './reporter';
export {
  checkQuota,
  createInMemorySubscriptionStore,
  DEFAULT_PLAN,
  type QuotaDecision,
  type Subscription,
  type SubscriptionPageOptions,
  type SubscriptionStore,
} from './subscriptions';
