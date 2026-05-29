// SPDX-License-Identifier: Elastic-2.0
import type { BranchRoutingPolicy } from '@pinagent/ee-team-features';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PolicyView } from '../src/Policy';

const policy = (over: Partial<BranchRoutingPolicy> = {}): BranchRoutingPolicy => ({
  organizationId: 'org_1',
  defaultBaseBranch: 'main',
  allowedBranchPatterns: ['feat/*', 'fix/*'],
  ...over,
});

describe('PolicyView', () => {
  it('renders the base branch and allowed patterns', () => {
    const html = renderToStaticMarkup(PolicyView({ branchRouting: policy() }));
    expect(html).toContain('main');
    expect(html).toContain('feat/*');
    expect(html).toContain('fix/*');
  });

  it('shows repo-default + any-branch when the policy is permissive', () => {
    const html = renderToStaticMarkup(
      PolicyView({ branchRouting: policy({ defaultBaseBranch: null, allowedBranchPatterns: [] }) }),
    );
    expect(html).toContain('Repo default');
    expect(html).toContain('Any branch is allowed.');
  });

  it('shows the no-policy empty state', () => {
    const html = renderToStaticMarkup(PolicyView({ branchRouting: null }));
    expect(html).toContain('agents may target any branch');
  });
});
