// SPDX-License-Identifier: Elastic-2.0

/**
 * ISO-8601 timestamp from an optional epoch-seconds override. Handlers thread
 * their `nowSeconds` test seam through here so audit timestamps are
 * deterministic under test and wall-clock in production.
 */
export function isoFromSeconds(seconds: number | undefined): string {
  return new Date((seconds ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
}
