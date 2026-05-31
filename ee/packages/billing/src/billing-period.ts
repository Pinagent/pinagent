// SPDX-License-Identifier: Elastic-2.0

import type { Plan } from './plans';
import type { Subscription } from './subscriptions';
import { DEFAULT_PLAN } from './subscriptions';

/**
 * Pure billing-period arithmetic. A subscription's `currentPeriodStart` anchors
 * the usage/quota window; these functions advance it once a whole interval has
 * elapsed. No clock of their own — the caller passes `now` (ISO-8601) — so the
 * logic is deterministic and testable.
 */

const MS_PER_DAY = 86_400_000;

/**
 * The current period start as of `now`: advance `currentPeriodStart` by whole
 * `intervalDays` increments until the period contains `now`. Returns the input
 * unchanged when the period hasn't elapsed yet (or when `intervalDays <= 0`),
 * and passes an unparseable date through untouched.
 *
 * Collapses many missed periods into a single advance — e.g. if rollover didn't
 * run for three intervals, the result is the start of the period covering
 * `now`, not three separate steps.
 */
export function nextPeriodStart(
  currentPeriodStart: string,
  intervalDays: number,
  now: string,
): string {
  if (intervalDays <= 0) return currentPeriodStart;
  const startMs = Date.parse(currentPeriodStart);
  const nowMs = Date.parse(now);
  if (Number.isNaN(startMs) || Number.isNaN(nowMs)) return currentPeriodStart;

  const intervalMs = intervalDays * MS_PER_DAY;
  const elapsed = Math.floor((nowMs - startMs) / intervalMs);
  if (elapsed <= 0) return currentPeriodStart;
  return new Date(startMs + elapsed * intervalMs).toISOString();
}

/** One subscription whose period moved during a rollover pass. */
export interface PeriodRoll {
  subscription: Subscription;
  previousPeriodStart: string;
  newPeriodStart: string;
}

/**
 * Given the full set of subscriptions and a clock, compute the rolls for the
 * subset whose period has actually elapsed. `planFor` resolves a plan id to its
 * {@link Plan}; an unknown id falls back to {@link DEFAULT_PLAN} (for its
 * `intervalDays`). Subscriptions still inside their period are omitted.
 */
export function advanceElapsedPeriods(
  subscriptions: readonly Subscription[],
  now: string,
  planFor: (planId: string) => Plan | null,
): PeriodRoll[] {
  const rolls: PeriodRoll[] = [];
  for (const subscription of subscriptions) {
    const plan = planFor(subscription.planId) ?? DEFAULT_PLAN;
    const next = nextPeriodStart(subscription.currentPeriodStart, plan.intervalDays, now);
    if (next !== subscription.currentPeriodStart) {
      rolls.push({
        subscription,
        previousPeriodStart: subscription.currentPeriodStart,
        newPeriodStart: next,
      });
    }
  }
  return rolls;
}
