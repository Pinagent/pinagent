// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import {
  type BranchRoutingPolicy,
  createInMemoryBranchRoutingStore,
  isBranchAllowed,
  matchBranchPattern,
} from '../src/branch-routing';

function policy(overrides: Partial<BranchRoutingPolicy> = {}): BranchRoutingPolicy {
  return {
    organizationId: 'acme',
    defaultBaseBranch: 'develop',
    allowedBranchPatterns: ['feat/*', 'fix/*'],
    ...overrides,
  };
}

describe('matchBranchPattern', () => {
  it('matches a literal', () => {
    expect(matchBranchPattern('main', 'main')).toBe(true);
    expect(matchBranchPattern('main', 'maintenance')).toBe(false); // anchored
  });

  it('matches a `*` glob', () => {
    expect(matchBranchPattern('feat/*', 'feat/login')).toBe(true);
    expect(matchBranchPattern('feat/*', 'feat/a/b')).toBe(true);
    expect(matchBranchPattern('feat/*', 'fix/login')).toBe(false);
  });

  it('treats regex metachars in the pattern literally', () => {
    expect(matchBranchPattern('release-1.0', 'release-1.0')).toBe(true);
    expect(matchBranchPattern('release-1.0', 'release-1x0')).toBe(false); // `.` is literal
  });
});

describe('isBranchAllowed', () => {
  it('allows any branch with no policy or no patterns', () => {
    expect(isBranchAllowed(null, 'anything')).toBe(true);
    expect(isBranchAllowed(policy({ allowedBranchPatterns: [] }), 'anything')).toBe(true);
  });

  it('allows a branch matching any pattern, rejects otherwise', () => {
    const p = policy();
    expect(isBranchAllowed(p, 'feat/x')).toBe(true);
    expect(isBranchAllowed(p, 'fix/y')).toBe(true);
    expect(isBranchAllowed(p, 'chore/z')).toBe(false);
  });
});

describe('in-memory branch-routing store', () => {
  it('round-trips get/upsert', async () => {
    const store = createInMemoryBranchRoutingStore([policy()]);
    expect(await store.get('acme')).toMatchObject({ defaultBaseBranch: 'develop' });
    expect(await store.get('nobody')).toBeNull();
    await store.upsert(policy({ defaultBaseBranch: 'main', allowedBranchPatterns: [] }));
    expect(await store.get('acme')).toMatchObject({
      defaultBaseBranch: 'main',
      allowedBranchPatterns: [],
    });
  });
});
