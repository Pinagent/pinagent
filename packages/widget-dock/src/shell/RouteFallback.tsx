// SPDX-License-Identifier: Apache-2.0
/**
 * Suspense fallback rendered while a code-split route's bundle is being
 * fetched. Keeps the chrome stable (nav rail + header stay) and only
 * paints into the `<main>` area — same shape the per-route loading
 * states would show once mounted, so the swap doesn't shift layout.
 */
import { LoadingState } from './states';

export function RouteFallback() {
  return <LoadingState rows={5} />;
}
