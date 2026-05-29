// SPDX-License-Identifier: Apache-2.0
/**
 * Branch-routing enforcement primitives (OSS / dev-side).
 *
 * The cloud control plane owns the *policy* (an org's default base branch +
 * allowed land-target patterns); this module is the on-machine enforcement of
 * it. The matching logic is re-implemented here rather than imported from the
 * Elastic `@pinagent/ee-team-features` package so the OSS agent-runner stays
 * free of any source-available dependency — the policy crosses the boundary
 * as plain data (today via local project settings; later pushed over the relay
 * channel) and is enforced with this code.
 *
 * Keep this behaviourally in sync with ee-team-features' `branch-routing.ts`:
 * patterns are anchored full-string globs where `*` matches any run of
 * characters, and an empty pattern list allows any branch.
 */

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match a branch name against a single `*`-glob pattern (anchored). */
export function matchBranchPattern(pattern: string, branch: string): boolean {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);
  return regex.test(branch);
}

/**
 * Whether `branch` may be landed on under `allowedPatterns`. An empty list
 * (the default) allows any branch — branch routing is opt-in.
 */
export function isBranchAllowed(allowedPatterns: readonly string[], branch: string): boolean {
  if (allowedPatterns.length === 0) return true;
  return allowedPatterns.some((pattern) => matchBranchPattern(pattern, branch));
}
