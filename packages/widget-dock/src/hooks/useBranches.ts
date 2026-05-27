// SPDX-License-Identifier: Apache-2.0
/**
 * Read-side hook for the Branches view. Same shape as `useChanges` —
 * goes through the injected DockTransport, keyed on transport.kind
 * so mock ↔ local swaps don't serve stale cross-source data.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { Branch } from '../fixtures/types';
import { useTransport } from '../transport';

export function useBranches(): UseQueryResult<Branch[]> {
  const transport = useTransport();
  return useQuery({
    queryKey: ['branches', transport.kind],
    queryFn: () => transport.listBranches(),
  });
}
