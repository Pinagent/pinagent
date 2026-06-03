// SPDX-License-Identifier: Elastic-2.0
export const PACKAGE_NAME = '@pinagent/ee-billing';

export { advanceElapsedPeriods, nextPeriodStart, type PeriodRoll } from './billing-period';
export { createInMemoryIssuanceLock, type IssuanceLock } from './issuance-lock';
export {
  createInMemoryUsageAlertStore,
  type UsageAlertClaim,
  type UsageAlertSeverity,
  type UsageAlertStore,
} from './usage-alerts';
export {
  assertValidUsageQuantity,
  createInMemoryMeterSink,
  type MeterSink,
  USAGE_KINDS,
  type UsageEvent,
  type UsageQuery,
  type UsageSummary,
} from './metering';
export {
  isSelfServiceablePlan,
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
  createStripeReporter,
  type StripeBillingClient,
  type StripeMeterEvent,
  type StripeReporterDeps,
} from './stripe-reporter';
export {
  checkQuota,
  createInMemorySubscriptionStore,
  DEFAULT_PLAN,
  type QuotaDecision,
  type Subscription,
  type SubscriptionPageOptions,
  type SubscriptionStore,
} from './subscriptions';
