// SPDX-License-Identifier: Apache-2.0
/**
 * Read-side hook for the PRs view. Same shape as `useBranches` /
 * `useChanges` — goes through the injected DockTransport so mock and
 * local share one consumer surface.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { PullRequest } from '../fixtures/types';
import { useTransport } from '../transport';

export function usePullRequests(): UseQueryResult<PullRequest[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: ['pullRequests', transport.kind],
    queryFn: () => transport.listPullRequests(),
  });
}
