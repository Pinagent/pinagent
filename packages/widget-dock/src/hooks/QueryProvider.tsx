// SPDX-License-Identifier: Apache-2.0
/**
 * TanStack Query provider for the dock. One QueryClient per app
 * instance; PR-B will wire the WebSocket subscription bridge so server
 * events invalidate / patch the relevant cache entries directly.
 *
 * Defaults are tuned for a long-lived dock surface:
 *   - 60s staleTime so background revalidation isn't constant
 *   - 5min gcTime so leaving a route briefly doesn't lose the cache
 *   - refetchOnWindowFocus enabled — the user often clicks the FAB
 *     after coming back from their editor, expecting fresh data
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

export function QueryProvider({ children }: { children: ReactNode }) {
  // useState ensures the QueryClient is created exactly once per
  // mount, even under React 18 StrictMode's double-effects.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
