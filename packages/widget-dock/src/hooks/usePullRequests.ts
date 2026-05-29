// SPDX-License-Identifier: Apache-2.0
/**
 * Read-side hook for the PRs view. Same shape as `useBranches` /
 * `useChanges` — goes through the injected DockTransport so mock and
 * local share one consumer surface.
 */
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { PullRequest } from '../fixtures/types';
import { useTransport } from '../transport';

const KEY = ['pullRequests'] as const;

export function usePullRequests(): UseQueryResult<PullRequest[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: [...KEY, transport.kind],
    queryFn: () => transport.listPullRequests(),
  });
}

/**
 * Reconcile PR state against GitHub on demand (the PRs view's "Refresh"
 * button). The reconciled list replaces the cached read so the rows
 * re-render with fresh state without a separate refetch.
 */
export function useRefreshPullRequests(): UseMutationResult<PullRequest[], Error, void> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => transport.refreshPullRequests(),
    onSuccess: (data) => qc.setQueryData([...KEY, transport.kind], data),
  });
}
