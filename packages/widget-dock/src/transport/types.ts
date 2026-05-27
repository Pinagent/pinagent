// SPDX-License-Identifier: Apache-2.0
/**
 * DockTransport — the boundary between the dock's React tree and the
 * outside world. Today there are two implementations:
 *
 *   - LocalTransport   — talks to a running pinagent dev-server over
 *                        same-origin HTTP (proxied through Vite in dev).
 *   - MockTransport    — serves the fixture data from src/fixtures/,
 *                        used for design review and when the dev preview
 *                        runs without a host backend. Enabled via
 *                        `?fixtures=on` in the URL.
 *
 * The spec defines two more contexts the interface will need to cover
 * later — EmbeddedTransport (postMessage to a host script) and
 * StandaloneTransport (direct calls into the hosted relay) — both will
 * implement this same interface so the React tree never changes.
 *
 * Methods are intentionally narrow: every dock view talks through one
 * of these, never `fetch` directly.
 */
import type { Conversation } from '../fixtures/types';

export interface ConversationFilters {
  /** Limit to conversations anchored to this URL. */
  page?: string;
  /** Free-text match against title + anchor location. */
  query?: string;
}

export interface DockTransport {
  /**
   * Distinguish transports for debug logging and dev-preview banners.
   * Not a feature flag — implementations branch on shape, not name.
   */
  readonly kind: 'local' | 'mock';

  /** List conversations the dock should show. Newest first. */
  listConversations(filters?: ConversationFilters): Promise<Conversation[]>;

  // Conversation detail, write operations, and project-wide live
  // subscriptions land in follow-up PRs. The interface intentionally
  // stays minimal here so PR-A ships a thin slice end-to-end.
}
