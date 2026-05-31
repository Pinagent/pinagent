// SPDX-License-Identifier: Elastic-2.0

/**
 * The boundary where billing events leave the control plane for an external
 * billing provider (Stripe). Kept as a port so the rollover service stays
 * provider-agnostic and unit-testable: the production `createStripeReporter`
 * (which needs API credentials) implements this later; until then the wiring
 * uses {@link noopBillingReporter}.
 */

/** A billing period that just advanced, reported once it has rolled over. */
export interface PeriodRolloverEvent {
  organizationId: string;
  planId: string;
  previousPeriodStart: string;
  newPeriodStart: string;
}

export interface BillingReporter {
  /**
   * Report that an org's billing period advanced — where a real adapter would
   * close out the prior period's metered usage and open the next invoice.
   */
  reportPeriodRollover(event: PeriodRolloverEvent): Promise<void>;
}

/** No-op reporter — the default until a Stripe-backed reporter is wired. */
export const noopBillingReporter: BillingReporter = {
  async reportPeriodRollover() {},
};
