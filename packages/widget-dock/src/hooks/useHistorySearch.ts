// SPDX-License-Identifier: Apache-2.0
/**
 * Debounced full-text search hook for the History route. Only fires
 * when the (trimmed) query is non-empty; the route uses the existing
 * client-side filter over the conversations cache for "show everything"
 * so we don't pay a server round-trip just to render the unchanged list.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { type HistorySearchHit, type HistorySearchQuery, useTransport } from '../transport';

const DEBOUNCE_MS = 200;

export function useDebouncedValue<T>(value: T, ms: number = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(handle);
  }, [value, ms]);
  return debounced;
}

export function useHistorySearch(query: HistorySearchQuery): UseQueryResult<HistorySearchHit[]> {
  const transport = useTransport();
  const trimmed = query.query.trim();
  return useQuery({
    queryKey: ['historySearch', transport.kind, trimmed, query.status ?? 'all'],
    queryFn: () => transport.searchHistory({ ...query, query: trimmed }),
    enabled: trimmed.length > 0,
    staleTime: 10_000,
  });
}
