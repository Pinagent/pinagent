// SPDX-License-Identifier: Apache-2.0
/**
 * Read-side hook for the repo's real git branches — base-branch
 * candidates for the PR composer's dropdown. Distinct from `useBranches`
 * (pinagent's per-conversation worktree branches). Keyed on
 * transport.kind so mock ↔ local swaps don't serve stale data.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useTransport } from '../transport';

export function useGitBranches(): UseQueryResult<string[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: ['gitBranches', transport.kind],
    queryFn: () => transport.listGitBranches(),
    // Branch lists rarely change mid-session; avoid refetch churn while
    // the composer is open.
    staleTime: 60_000,
  });
}
