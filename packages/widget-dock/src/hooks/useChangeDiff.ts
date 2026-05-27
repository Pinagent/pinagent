// SPDX-License-Identifier: Apache-2.0
/**
 * Lazy diff loader for the Changes view. Skipped while the row is
 * collapsed so we don't pay the diff cost up front; fires once the
 * user opens a row, then stays cached so re-toggling doesn't refetch.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type ChangeDiff, useTransport } from '../transport';

export interface UseChangeDiffOpts {
  enabled: boolean;
}

export function useChangeDiff(
  id: string,
  opts: UseChangeDiffOpts,
): UseQueryResult<ChangeDiff | null> {
  const transport = useTransport();
  return useQuery({
    queryKey: ['changeDiff', transport.kind, id],
    queryFn: () => transport.getChangeDiff(id),
    enabled: opts.enabled,
    // Diffs change whenever the agent commits; the project subscription
    // already invalidates the Changes list on `conversations_changed`.
    // For per-diff freshness, a 30s staleness window is a reasonable
    // tradeoff between "always fresh" and "don't thrash on re-expand".
    staleTime: 30_000,
  });
}
