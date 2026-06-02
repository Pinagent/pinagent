// SPDX-License-Identifier: Elastic-2.0
import {
  advanceElapsedPeriods,
  type BillingReporter,
  planById,
  type SubscriptionStore,
} from '@pinagent/ee-billing';
import { AUDIT_ACTIONS, type AuditSink } from '@pinagent/ee-team-features';

/**
 * Billing-period rollover — advance every subscription whose period has elapsed
 * so usage/quota windows reset. Pure period math lives in `ee-billing`
 * (`advanceElapsedPeriods`); this orchestrates the stores + the external
 * billing report.
 *
 *   POST /internal/billing/roll   Authorization: Bearer <internal secret>
 *     → 200 { rolled }
 *
 * Service-to-service (a cron / scheduled worker calls it), authenticated by the
 * shared internal secret — not an end-user endpoint. The same `runBillingRollover`
 * backs the Worker's `scheduled()` handler.
 */

/** Deps the rollover pass needs (no auth — callable directly from `scheduled()`). */
export interface RolloverDeps {
  subscriptions: SubscriptionStore;
  /** External billing report (Stripe). Best-effort per subscription. */
  reporter?: BillingReporter;
  /** Records a `billing.period.rolled` audit event per advanced org. */
  audit?: AuditSink;
  /** ISO-8601 clock — injected for deterministic tests. */
  now: () => string;
  /** Subscriptions fetched per page (default {@link DEFAULT_ROLLOVER_PAGE_SIZE}). */
  pageSize?: number;
}

/** Default subscriptions scanned per rollover page — bounds memory + DB load. */
const DEFAULT_ROLLOVER_PAGE_SIZE = 500;

export interface BillingServiceDeps extends RolloverDeps {
  /** Shared secret the trigger presents as a bearer token. */
  internalSecret: string;
}

/**
 * Advance the elapsed subscriptions: reset each window (`currentPeriodStart`),
 * report the rollover to the billing provider, and audit it. Idempotent —
 * re-running only moves periods that have since elapsed. Returns the count.
 *
 * Walks the table in keyset pages (by `organizationId`) so a large tenant base
 * doesn't load every subscription into the Worker at once. Paging is stable
 * under the in-loop `upsert`s because they change only `currentPeriodStart`,
 * not the `organizationId` cursor.
 */
export async function runBillingRollover(deps: RolloverDeps): Promise<{ rolled: number }> {
  const at = deps.now();
  const limit = deps.pageSize ?? DEFAULT_ROLLOVER_PAGE_SIZE;
  let after: string | undefined;
  let rolled = 0;

  for (;;) {
    const page = await deps.subscriptions.listPage({ after, limit });
    if (page.length === 0) break;
    after = page[page.length - 1]?.organizationId;

    const rolls = advanceElapsedPeriods(page, at, planById);
    for (const roll of rolls) {
      await deps.subscriptions.upsert({
        ...roll.subscription,
        currentPeriodStart: roll.newPeriodStart,
      });
      try {
        await deps.reporter?.reportPeriodRollover({
          organizationId: roll.subscription.organizationId,
          planId: roll.subscription.planId,
          previousPeriodStart: roll.previousPeriodStart,
          newPeriodStart: roll.newPeriodStart,
        });
      } catch {
        // Best-effort: a provider failure must not abort the rest of the batch.
      }
      await deps.audit?.record({
        occurredAt: at,
        organizationId: roll.subscription.organizationId,
        actorUserId: null,
        action: AUDIT_ACTIONS.periodRolled,
        metadata: {
          previousPeriodStart: roll.previousPeriodStart,
          newPeriodStart: roll.newPeriodStart,
        },
      });
    }
    rolled += rolls.length;
    if (page.length < limit) break;
  }
  return { rolled };
}

/** POST /internal/billing/roll — secret-authed trigger for the rollover pass. */
export async function handleBillingRoll(
  request: Request,
  deps: BillingServiceDeps,
): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const provided = bearer(request.headers.get('Authorization'));
  if (!provided || !timingSafeEqual(provided, deps.internalSecret)) {
    return json({ error: 'unauthorized' }, 401);
  }
  return json(await runBillingRollover(deps), 200);
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  return token ? token : null;
}

/** Length-aware constant-time-ish compare for the shared secret. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
