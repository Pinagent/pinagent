// SPDX-License-Identifier: Apache-2.0
/**
 * Read + prune hooks for the Branches view. The list query is keyed on
 * transport.kind so mock ↔ local swaps don't serve stale cross-source
 * data; the prune mutations invalidate the same key so a successful
 * prune drops the row without a manual refetch.
 */
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { Branch } from '../fixtures/types';
import { type PruneStaleResult, useTransport } from '../transport';

const KEY = ['branches'] as const;

export function useBranches(): UseQueryResult<Branch[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: [...KEY, transport.kind],
    queryFn: () => transport.listBranches(),
  });
}

export function usePruneBranch(): UseMutationResult<void, Error, string> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feedbackId: string) => transport.pruneBranch(feedbackId),
    // Server-side prune is also a discard, so the Conversations list
    // changes too — invalidate both caches so the dock stays consistent
    // across views.
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...KEY, transport.kind] }),
        qc.invalidateQueries({ queryKey: ['conversations', transport.kind] }),
      ]);
    },
  });
}

export function usePruneStaleBranches(): UseMutationResult<PruneStaleResult, Error, void> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => transport.pruneStaleBranches(),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...KEY, transport.kind] }),
        qc.invalidateQueries({ queryKey: ['conversations', transport.kind] }),
      ]);
    },
  });
}
