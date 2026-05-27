// SPDX-License-Identifier: Apache-2.0
/**
 * MockTransport — serves the dock's fixture data without touching the
 * network. Used for design review and any time the dev preview is run
 * without a host backend behind it.
 *
 * Enabled via `?fixtures=on` in the URL; see App.tsx for the gate.
 */
import { type Conversation, FIXTURE_CONVERSATIONS } from '../fixtures';
import type { ConversationFilters, DockTransport } from './types';

/** Small artificial latency so loading states are visible while reviewing. */
const SIMULATED_LATENCY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockTransport implements DockTransport {
  readonly kind = 'mock' as const;

  async listConversations(filters?: ConversationFilters): Promise<Conversation[]> {
    await sleep(SIMULATED_LATENCY_MS);
    return FIXTURE_CONVERSATIONS.slice()
      .filter((c) => !filters?.page || c.page === filters.page)
      .filter((c) => {
        if (!filters?.query) return true;
        const q = filters.query.toLowerCase();
        return c.title.toLowerCase().includes(q) || c.anchor.loc.toLowerCase().includes(q);
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
}
