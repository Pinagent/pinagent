// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import type { MyOrg } from '../src/api-client';
import { activeOrgLabel, orgHref } from '../src/org-switcher-model';

const org = (over: Partial<MyOrg> = {}): MyOrg => ({
  organizationId: 'acme',
  displayName: 'Acme',
  slug: 'acme',
  role: 'admin',
  status: 'active',
  ...over,
});

describe('orgHref', () => {
  it('keeps the tab path and sets ?org=, encoding the id', () => {
    expect(orgHref('/', 'acme')).toBe('/?org=acme');
    expect(orgHref('/billing', 'org/with space')).toBe('/billing?org=org%2Fwith%20space');
  });
});

describe('activeOrgLabel', () => {
  it('uses the matching org display name', () => {
    const orgs = [org({ organizationId: 'a', displayName: 'Alpha' }), org({ organizationId: 'b' })];
    expect(activeOrgLabel(orgs, 'a')).toBe('Alpha');
  });

  it('falls back to the raw id when the list is empty or has no match', () => {
    expect(activeOrgLabel([], 'acme')).toBe('acme');
    expect(activeOrgLabel([org({ organizationId: 'other' })], 'acme')).toBe('acme');
  });
});
