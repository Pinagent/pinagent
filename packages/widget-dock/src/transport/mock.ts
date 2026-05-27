// SPDX-License-Identifier: Apache-2.0
/**
 * MockTransport — serves the dock's fixture data without touching the
 * network. Used for design review and any time the dev preview is run
 * without a host backend behind it.
 *
 * Enabled via `?fixtures=on` in the URL; see App.tsx for the gate.
 */
import type { ProjectEvent } from '@pinagent/shared';
import {
  type Branch,
  type Change,
  type Conversation,
  FIXTURE_BRANCHES,
  FIXTURE_CHANGES,
  FIXTURE_CONVERSATIONS,
} from '../fixtures';
import type {
  ChangeDiff,
  ConversationDetail,
  ConversationFilters,
  CreatePullRequestInput,
  CreatePullRequestResult,
  DockTransport,
} from './types';
import type { ConnectionStatus, ConversationHandlers } from './ws-client';

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

  async getChangeDiff(id: string): Promise<ChangeDiff | null> {
    await sleep(SIMULATED_LATENCY_MS);
    const c = FIXTURE_CHANGES.find((c) => c.id === id);
    if (!c) return null;
    // Synthesize a small unified-diff body from the fixture's preview so
    // the expanded UI is reviewable end-to-end in fixtures mode. Real
    // diffs from the dev-server come through unchanged.
    const synthetic = [
      `diff --git a/${c.branch || 'fixture'}/example.tsx b/${c.branch || 'fixture'}/example.tsx`,
      `--- a/example.tsx`,
      `+++ b/example.tsx`,
      `@@ -1,${Math.max(c.deletions, 1)} +1,${Math.max(c.additions, 1)} @@`,
      ...(c.preview || '+ // fixture: no preview captured').split('\n'),
    ].join('\n');
    return { diff: synthetic, truncated: false };
  }

  async listChanges(): Promise<Change[]> {
    await sleep(SIMULATED_LATENCY_MS);
    return FIXTURE_CHANGES.slice().sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  }

  async listBranches(): Promise<Branch[]> {
    await sleep(SIMULATED_LATENCY_MS);
    return FIXTURE_BRANCHES.slice().sort(
      (a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity),
    );
  }

  async getConversation(id: string): Promise<ConversationDetail | null> {
    await sleep(SIMULATED_LATENCY_MS);
    const c = FIXTURE_CONVERSATIONS.find((c) => c.id === id);
    if (!c) return null;
    return {
      ...c,
      // Fixtures don't carry the full original comment; reuse the title.
      comment: c.title,
      screenshot: null,
    };
  }

  // No real WS in mock mode — these methods report a stable "idle" status
  // and never deliver events. Components that care can branch on
  // transport.kind === 'mock' to render a "fixtures, no live stream"
  // placeholder.
  subscribeProject(_listener: (event: ProjectEvent) => void): () => void {
    return () => {};
  }

  onConnectionStatus(listener: (status: ConnectionStatus) => void): () => void {
    listener('idle');
    return () => {};
  }

  subscribeConversation(_id: string, _handlers: ConversationHandlers): () => void {
    return () => {};
  }

  sendUserMessage(_id: string, _content: string): void {
    // no-op
  }

  sendAskResponse(_askId: string, _answer: string): void {
    // no-op
  }

  landConversation(_id: string): void {
    // no-op
  }

  discardConversation(_id: string): void {
    // no-op
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
    // Simulated success — return a plausible PR URL so the composer's
    // happy-path UI can be reviewed without a host backend. Slight delay
    // mimics the real round-trip so the submit spinner is visible.
    await sleep(SIMULATED_LATENCY_MS * 4);
    return {
      ok: true,
      branchPushed: true,
      prUrl: `https://github.com/example/repo/pull/999?branch=${encodeURIComponent(input.branchName)}`,
    };
  }
}
