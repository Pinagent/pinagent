// SPDX-License-Identifier: Apache-2.0
/**
 * Read-side hook for the Changes view. Same shape as useConversations
 * — goes through the injected DockTransport, keyed on transport.kind
 * so mock ↔ local swaps don't serve stale cross-source data.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { Change } from '../fixtures/types';
import { useTransport } from '../transport';

export function useChanges(): UseQueryResult<Change[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: ['changes', transport.kind],
    queryFn: () => transport.listChanges(),
  });
}
