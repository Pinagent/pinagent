// SPDX-License-Identifier: Apache-2.0
/**
 * Audit-log feed for the History route's Activity tab.
 *
 * Invalidated by `useProjectSubscription` on any `conversations_changed`
 * event — the audit emit sites are the same write paths that drive
 * those broadcasts, so a single channel keeps the feed fresh without a
 * dedicated subscription.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type AuditEvent, type ListAuditEventsQuery, useTransport } from '../transport';

export function useAuditLog(opts: ListAuditEventsQuery = {}): UseQueryResult<AuditEvent[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: [
      'auditLog',
      transport.kind,
      opts.limit ?? null,
      opts.offset ?? null,
      opts.conversationId ?? null,
    ],
    queryFn: () => transport.listAuditEvents(opts),
    staleTime: 10_000,
  });
}
