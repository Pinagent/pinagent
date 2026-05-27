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
  FIXTURE_ANTHROPIC,
  FIXTURE_BRANCHES,
  FIXTURE_CHANGES,
  FIXTURE_CONVERSATIONS,
  FIXTURE_GITHUB,
  FIXTURE_PRS,
  FIXTURE_SETTINGS,
  type PullRequest,
} from '../fixtures';
import type {
  ChangeDiff,
  ConversationDetail,
  ConversationFilters,
  CreatePullRequestInput,
  CreatePullRequestResult,
  DockProjectSettings,
  DockTransport,
  PresentableConnections,
  PruneStaleResult,
} from './types';
import type { ConnectionStatus, ConversationHandlers } from './ws-client';

/** Small artificial latency so loading states are visible while reviewing. */
const SIMULATED_LATENCY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockTransport implements DockTransport {
  readonly kind = 'mock' as const;

  // Mutable per-instance branches list so the prune flows have something
  // observable to remove. Seeded from the fixtures on construction.
  private branches: Branch[] = FIXTURE_BRANCHES.slice();

  // In-memory copies of the connection + settings fixtures so the
  // dock's set/clear/patch flows mutate something observable. Resets
  // whenever the page reloads — by design, since this is review-only.
  private connections: PresentableConnections = {
    github: { connected: FIXTURE_GITHUB.connected, login: FIXTURE_GITHUB.account },
    anthropic: { keySet: FIXTURE_ANTHROPIC.keySet },
  };
  private settings: DockProjectSettings = {
    baseBranch: FIXTURE_SETTINGS.baseBranch,
    worktreeRetentionDays: FIXTURE_SETTINGS.worktreeRetentionDays,
    perConversationCapUsd: FIXTURE_SETTINGS.perConversationCapUsd,
    monthlyBudgetUsd: FIXTURE_SETTINGS.monthlyBudgetUsd,
    permissionMode: FIXTURE_SETTINGS.permissionMode,
  };

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
    return this.branches
      .slice()
      .sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity));
  }

  async pruneBranch(feedbackId: string): Promise<void> {
    await sleep(SIMULATED_LATENCY_MS * 2);
    const before = this.branches.length;
    this.branches = this.branches.filter((b) => b.conversationId !== feedbackId);
    if (this.branches.length === before) {
      throw new Error('Branch already pruned (mock validation)');
    }
  }

  async pruneStaleBranches(): Promise<PruneStaleResult> {
    await sleep(SIMULATED_LATENCY_MS * 2);
    const retentionDays = this.settings.worktreeRetentionDays;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const stale = this.branches.filter((b) => Date.parse(b.lastActivity) < cutoff);
    this.branches = this.branches.filter((b) => Date.parse(b.lastActivity) >= cutoff);
    return {
      pruned: stale.map((b) => b.conversationId).filter((id): id is string => id !== null),
      failed: [],
      retentionDays,
    };
  }

  async listPullRequests(): Promise<PullRequest[]> {
    await sleep(SIMULATED_LATENCY_MS);
    return FIXTURE_PRS.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
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

  async getConnections(): Promise<PresentableConnections> {
    await sleep(SIMULATED_LATENCY_MS);
    return this.connections;
  }

  async setGithubConnection(token: string): Promise<PresentableConnections> {
    await sleep(SIMULATED_LATENCY_MS * 3);
    // Pretend any non-empty token resolves to a plausible login. Reject
    // obviously bogus tokens so the error-state UI is reviewable too.
    if (token.length < 4) throw new Error('Invalid token (mock validation)');
    this.connections = {
      ...this.connections,
      github: { connected: true, login: 'fixture-user' },
    };
    return this.connections;
  }

  async clearGithubConnection(): Promise<PresentableConnections> {
    await sleep(SIMULATED_LATENCY_MS);
    this.connections = { ...this.connections, github: { connected: false, login: null } };
    return this.connections;
  }

  async setAnthropicConnection(key: string): Promise<PresentableConnections> {
    await sleep(SIMULATED_LATENCY_MS * 3);
    if (key.length < 4) throw new Error('Invalid key (mock validation)');
    this.connections = { ...this.connections, anthropic: { keySet: true } };
    return this.connections;
  }

  async clearAnthropicConnection(): Promise<PresentableConnections> {
    await sleep(SIMULATED_LATENCY_MS);
    this.connections = { ...this.connections, anthropic: { keySet: false } };
    return this.connections;
  }

  async getSettings(): Promise<DockProjectSettings> {
    await sleep(SIMULATED_LATENCY_MS);
    return this.settings;
  }

  async updateSettings(patch: Partial<DockProjectSettings>): Promise<DockProjectSettings> {
    await sleep(SIMULATED_LATENCY_MS * 2);
    this.settings = { ...this.settings, ...patch };
    return this.settings;
  }
}
