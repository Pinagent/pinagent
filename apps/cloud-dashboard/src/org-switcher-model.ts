// SPDX-License-Identifier: Elastic-2.0
import type { MyOrg } from './api-client';

/**
 * Pure helpers for the org switcher, kept DOM-free so they're unit-testable
 * without rendering the radix dropdown.
 */

/** Link to the same page (tab) with a different active org in `?org=`. */
export function orgHref(basePath: string, orgId: string): string {
  return `${basePath}?org=${encodeURIComponent(orgId)}`;
}

/**
 * Human label for the active org: its display name once the list has loaded,
 * else the raw id (so the trigger reads sensibly before/without the fetch).
 */
export function activeOrgLabel(orgs: MyOrg[], activeOrg: string): string {
  return orgs.find((o) => o.organizationId === activeOrg)?.displayName ?? activeOrg;
}
