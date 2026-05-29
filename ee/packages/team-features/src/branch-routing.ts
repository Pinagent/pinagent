// SPDX-License-Identifier: Elastic-2.0

/**
 * Org branch-routing policy — a team governs which branch agents target by
 * default and which branches their worktrees may land on. The cloud stores +
 * serves the policy; enforcement is dev-side (the agent-runner consults
 * {@link isBranchAllowed} when creating/landing a worktree).
 *
 * Driver-free domain core: the policy shape, the `BranchRoutingStore` port, a
 * pure matcher, and an in-memory impl. The Postgres adapter + admin config
 * endpoints live in the cloud app.
 */

export interface BranchRoutingPolicy {
  organizationId: string;
  /** Base branch agents should target by default; `null` = the repo default. */
  defaultBaseBranch: string | null;
  /**
   * Glob patterns (`*` = any run of chars) of branch names worktrees may land
   * on. Empty = allow any branch.
   */
  allowedBranchPatterns: string[];
}

export interface BranchRoutingStore {
  get(organizationId: string): Promise<BranchRoutingPolicy | null>;
  upsert(policy: BranchRoutingPolicy): Promise<void>;
}

/**
 * Whether `branch` is permitted under `policy`. No policy, or an empty pattern
 * list, allows any branch. Patterns are anchored full-string globs.
 */
export function isBranchAllowed(policy: BranchRoutingPolicy | null, branch: string): boolean {
  if (!policy || policy.allowedBranchPatterns.length === 0) return true;
  return policy.allowedBranchPatterns.some((pattern) => matchBranchPattern(pattern, branch));
}

/** Match a branch name against a single `*`-glob pattern (anchored). */
export function matchBranchPattern(pattern: string, branch: string): boolean {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);
  return regex.test(branch);
}

export function createInMemoryBranchRoutingStore(
  seed: BranchRoutingPolicy[] = [],
): BranchRoutingStore {
  const byOrg = new Map<string, BranchRoutingPolicy>(seed.map((p) => [p.organizationId, p]));
  return {
    async get(organizationId: string): Promise<BranchRoutingPolicy | null> {
      return byOrg.get(organizationId) ?? null;
    },
    async upsert(policy: BranchRoutingPolicy): Promise<void> {
      byOrg.set(policy.organizationId, policy);
    },
  };
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
