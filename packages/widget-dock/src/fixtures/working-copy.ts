// SPDX-License-Identifier: Apache-2.0
import type { WorkingCopyStatus } from '@pinagent/shared';

/**
 * A feature branch with a handful of uncommitted edits and no PR yet —
 * the dashboard's "Create PR" entry state. Swap `pr` / `ahead` to review
 * the "Push changes" and "View PR" button states.
 */
export const FIXTURE_WORKING_COPY: WorkingCopyStatus = {
  branch: 'feat/pricing-tiers',
  baseBranch: 'main',
  isDefaultBranch: false,
  filesChanged: 4,
  additions: 96,
  deletions: 23,
  files: [
    { path: 'src/components/PricingTable.tsx', added: 52, deleted: 8, status: 'modified' },
    { path: 'src/components/PricingTier.tsx', added: 31, deleted: 0, status: 'added' },
    { path: 'src/lib/pricing.ts', added: 13, deleted: 4, status: 'modified' },
    { path: 'src/components/LegacyPricing.tsx', added: 0, deleted: 11, status: 'deleted' },
  ],
  ahead: 3,
  behind: 0,
  hasUpstream: false,
  dirty: true,
  pr: null,
};
