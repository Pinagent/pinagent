// SPDX-License-Identifier: Elastic-2.0

/**
 * Org-configurable cost controls — a self-imposed usage guardrail, distinct
 * from the billing plan quota. Where the plan quota is what an org's plan
 * *allows* (`ee-billing`), a cost control is a cap the org's own admins set to
 * stay under budget, and can be tighter than the plan. It can `block` issuance
 * over the cap, or `warn` (allow but flag for audit).
 *
 * Driver-free domain core: the policy shape, the `CostControlStore` port, a
 * pure evaluator, and an in-memory impl. The Postgres adapter + enforcement
 * wiring live in the cloud app.
 */

export type CostControlEnforcement = 'block' | 'warn';

export interface CostControl {
  organizationId: string;
  /** Cap on relay sessions per billing period; `null` = no cap. */
  maxRelaySessionsPerPeriod: number | null;
  /** `block` rejects issuance over the cap; `warn` allows but flags it. */
  enforcement: CostControlEnforcement;
}

export interface CostControlStore {
  get(organizationId: string): Promise<CostControl | null>;
  upsert(control: CostControl): Promise<void>;
}

export interface CostDecision {
  /** False only when over the cap AND enforcement is `block`. */
  allowed: boolean;
  /** True when `used + additional` exceeds the cap (in either mode). */
  overCap: boolean;
  enforcement: CostControlEnforcement | 'none';
  cap: number | null;
  used: number;
}

/**
 * Decide whether `used + additional` (default +1) fits under an org's cost
 * control. No control, or a null cap, is always allowed.
 */
export function evaluateCostControl(
  control: CostControl | null,
  used: number,
  additional = 1,
): CostDecision {
  if (!control || control.maxRelaySessionsPerPeriod === null) {
    return { allowed: true, overCap: false, enforcement: 'none', cap: null, used };
  }
  const cap = control.maxRelaySessionsPerPeriod;
  const overCap = used + additional > cap;
  return {
    allowed: !(overCap && control.enforcement === 'block'),
    overCap,
    enforcement: control.enforcement,
    cap,
    used,
  };
}

/** In-memory cost-control store for tests/dev. */
export function createInMemoryCostControlStore(seed: CostControl[] = []): CostControlStore {
  const byOrg = new Map<string, CostControl>(seed.map((c) => [c.organizationId, c]));
  return {
    async get(organizationId: string): Promise<CostControl | null> {
      return byOrg.get(organizationId) ?? null;
    },
    async upsert(control: CostControl): Promise<void> {
      byOrg.set(control.organizationId, control);
    },
  };
}
