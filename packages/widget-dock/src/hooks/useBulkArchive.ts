// SPDX-License-Identifier: Apache-2.0
/**
 * Mutation hook for `transport.bulkArchive` — the Conversations list's
 * multi-select uses this to archive (or unarchive) up to 200 rows in
 * one call.
 *
 * Invalidates the conversations list query so archived rows drop out
 * (or reappear, depending on the Show-archived toggle) without a
 * manual refetch. Also invalidates the audit log query so the single
 * bulk audit event appears in History → Activity immediately. The
 * server-side `conversations_changed` project events from each
 * Storage.patch fire in parallel; TanStack Query's coalescing
 * collapses those repeated invalidations into one refetch.
 */
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { type BulkArchiveResult, useTransport } from '../transport';

export interface BulkArchiveVariables {
  ids: string[];
  archived: boolean;
}

export function useBulkArchive(): UseMutationResult<
  BulkArchiveResult,
  Error,
  BulkArchiveVariables
> {
  const transport = useTransport();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, archived }) => transport.bulkArchive(ids, archived),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['conversations', transport.kind] }),
        qc.invalidateQueries({ queryKey: ['auditLog', transport.kind] }),
      ]);
    },
  });
}
