// SPDX-License-Identifier: Apache-2.0
/**
 * Pure branch-routing matching. Kept behaviourally in sync with
 * ee-team-features' `branch-routing.ts` (anchored `*`-glob, empty = allow).
 */
import { describe, expect, it } from 'vitest';
import { isBranchAllowed, matchBranchPattern } from '../src/branch-routing';

describe('matchBranchPattern', () => {
  it('matches a literal pattern exactly (anchored)', () => {
    expect(matchBranchPattern('main', 'main')).toBe(true);
    expect(matchBranchPattern('main', 'mainline')).toBe(false);
    expect(matchBranchPattern('main', 'remotes/main')).toBe(false);
  });

  it('treats * as any run of characters', () => {
    expect(matchBranchPattern('feat/*', 'feat/dashboard')).toBe(true);
    expect(matchBranchPattern('feat/*', 'feat/')).toBe(true);
    expect(matchBranchPattern('feat/*', 'fix/bug')).toBe(false);
    expect(matchBranchPattern('*/wip', 'alice/wip')).toBe(true);
    expect(matchBranchPattern('release-*-rc', 'release-2-rc')).toBe(true);
  });

  it('escapes regex-special characters in the literal parts', () => {
    expect(matchBranchPattern('v1.0', 'v1.0')).toBe(true);
    // the dot is literal, not "any char"
    expect(matchBranchPattern('v1.0', 'v1x0')).toBe(false);
  });
});

describe('isBranchAllowed', () => {
  it('allows any branch when the pattern list is empty (opt-in)', () => {
    expect(isBranchAllowed([], 'main')).toBe(true);
    expect(isBranchAllowed([], 'anything/goes')).toBe(true);
  });

  it('allows a branch matching any one pattern', () => {
    expect(isBranchAllowed(['feat/*', 'fix/*'], 'fix/login')).toBe(true);
    expect(isBranchAllowed(['feat/*', 'fix/*'], 'feat/x')).toBe(true);
  });

  it('rejects a branch matching no pattern', () => {
    expect(isBranchAllowed(['feat/*', 'fix/*'], 'main')).toBe(false);
    expect(isBranchAllowed(['release/*'], 'hotfix/urgent')).toBe(false);
  });
});
