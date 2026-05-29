// SPDX-License-Identifier: Apache-2.0
/**
 * MockTransport — serves the dock's fixture data without touching the
 * network. Used for design review and any time the dev preview is run
 * without a host backend behind it.
 *
 * Enabled via `?fixtures=on` in the URL; see App.tsx for the gate.
 */
import type { AgentEvent, ProjectEvent } from '@pinagent/shared';
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
  FIXTURE_TRANSCRIPTS,
  type PullRequest,
} from '../fixtures';
import type {
  AuditEvent,
  BulkArchiveResult,
  BulkPruneResult,
  BulkReopenResult,
  ChangeDiff,
  ConversationDetail,
  ConversationFilters,
  ConversationUpdate,
  CreatePullRequestInput,
  CreatePullRequestResult,
  DockProjectSettings,
  DockTransport,
  HistoryMatchedField,
  HistorySearchHit,
  HistorySearchQuery,
  ListAuditEventsQuery,
  PresentableConnections,
  PruneStaleResult,
  ServeBranchResult,
} from './types';
import type { ConnectionStatus, ConversationHandlers, ExtensionStatus } from './ws-client';

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

  // Mutable per-instance conversations list so rename / archive flows
  // have something observable to mutate. Resets on reload.
  private conversations: Conversation[] = FIXTURE_CONVERSATIONS.map((c) => ({ ...c }));

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
    // Mock transport has no dev-server, so no env override.
    permissionModeOverride: null,
  };

  async listConversations(filters?: ConversationFilters): Promise<Conversation[]> {
    await sleep(SIMULATED_LATENCY_MS);
    return this.conversations
      .slice()
      .filter((c) => !filters?.page || c.page === filters.page)
      .filter((c) => filters?.includeArchived || !c.archived)
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

  async serveBranch(feedbackId: string): Promise<ServeBranchResult> {
    await sleep(SIMULATED_LATENCY_MS * 2);
    const branch = this.branches.find((b) => b.conversationId === feedbackId);
    if (!branch) throw new Error('Branch not found (mock validation)');
    // Deterministic fake port so the mock UI is stable across renders.
    return { url: 'http://localhost:53700', port: 53700, reused: false };
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

  async bulkPruneBranches(feedbackIds: string[]): Promise<BulkPruneResult> {
    await sleep(SIMULATED_LATENCY_MS * 2);
    const pruned: string[] = [];
    const failed: { feedbackId: string; error: string }[] = [];
    const wanted = new Set(feedbackIds);
    const remaining: Branch[] = [];
    for (const b of this.branches) {
      if (b.conversationId && wanted.has(b.conversationId)) {
        pruned.push(b.conversationId);
      } else {
        remaining.push(b);
      }
    }
    this.branches = remaining;
    // Ids in the request that didn't match a fixture row → "failed"
    // (mirrors the real server's pruneBranch shape for unknown ids).
    const seen = new Set(pruned);
    for (const id of feedbackIds) {
      if (!seen.has(id)) failed.push({ feedbackId: id, error: 'conversation not found' });
    }
    return { pruned, failed };
  }

  async bulkReopenConversations(feedbackIds: string[]): Promise<BulkReopenResult> {
    await sleep(SIMULATED_LATENCY_MS * 2);
    const reopened: string[] = [];
    const failed: { feedbackId: string; error: string }[] = [];
    const now = new Date().toISOString();
    // Mirror the server: flips status off of resolved (landed/discarded
    // /error) back to pending. Anything else → failed.
    for (const id of feedbackIds) {
      const idx = this.conversations.findIndex((c) => c.id === id);
      const existing = idx >= 0 ? this.conversations[idx] : undefined;
      if (!existing) {
        failed.push({ feedbackId: id, error: 'conversation not found' });
        continue;
      }
      if (
        existing.status !== 'landed' &&
        existing.status !== 'discarded' &&
        existing.status !== 'error'
      ) {
        failed.push({
          feedbackId: id,
          error: `cannot reopen: status is ${existing.status} (expected landed/discarded)`,
        });
        continue;
      }
      this.conversations[idx] = { ...existing, status: 'pending', updatedAt: now };
      reopened.push(id);
    }
    return { reopened, failed };
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

  async getConversationMessages(id: string): Promise<AgentEvent[]> {
    // `FIXTURE_TRANSCRIPTS` covers a representative slice — conversations
    // outside the map return [] (same shape as a brand-new pre-spawn
    // run, which is also a legitimate demo state). The map is keyed on
    // the `Conversation.id` (`cv_01` etc.), not shortId.
    await sleep(SIMULATED_LATENCY_MS);
    return FIXTURE_TRANSCRIPTS[id] ?? [];
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

  subscribeExtensionStatus(listener: (status: ExtensionStatus) => void): () => void {
    // Fixtures present the happy path: extension installed, like the
    // pre-connected GitHub/Anthropic fixtures. Design review of the
    // not-installed state runs against a real dev-server without the
    // extension connected.
    listener({ present: true, version: '0.0.1' });
    return () => {};
  }

  subscribeConversation(_id: string, _handlers: ConversationHandlers): () => void {
    return () => {};
  }

  sendUserMessage(_id: string, _content: string): void {
    // no-op
  }

  sendInterrupt(_id: string): void {
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

  reopenConversation(_id: string): void {
    // no-op
  }

  async updateConversation(id: string, patch: ConversationUpdate): Promise<Conversation> {
    await sleep(SIMULATED_LATENCY_MS);
    const idx = this.conversations.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`mock: conversation ${id} not found`);
    const existing = this.conversations[idx];
    if (!existing) throw new Error(`mock: conversation ${id} not found`);
    const next: Conversation = {
      ...existing,
      // Empty title collapses back to the existing title — for the mock
      // we don't have access to the original comment, so we approximate
      // by reusing whatever title is currently shown.
      title:
        patch.title === undefined
          ? existing.title
          : patch.title && patch.title.trim().length > 0
            ? patch.title.trim()
            : existing.title,
      archived: patch.archived === undefined ? existing.archived : patch.archived,
      updatedAt: new Date().toISOString(),
    };
    this.conversations[idx] = next;
    return next;
  }

  async bulkArchive(ids: string[], archived: boolean): Promise<BulkArchiveResult> {
    await sleep(SIMULATED_LATENCY_MS);
    const updated: string[] = [];
    const skipped: string[] = [];
    const now = new Date().toISOString();
    for (const id of ids) {
      const idx = this.conversations.findIndex((c) => c.id === id);
      const existing = idx >= 0 ? this.conversations[idx] : undefined;
      if (!existing || existing.archived === archived) {
        skipped.push(id);
        continue;
      }
      this.conversations[idx] = { ...existing, archived, updatedAt: now };
      updated.push(id);
    }
    return { updated, skipped };
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

  async searchHistory(query: HistorySearchQuery): Promise<HistorySearchHit[]> {
    await sleep(SIMULATED_LATENCY_MS);
    const trimmed = query.query.trim().toLowerCase();
    if (trimmed.length === 0) return [];
    const statusFilter = query.status ?? 'all';
    // Reuse the resolved set from fixtures — the dock's status-derive
    // marks landed/discarded/error as resolved; for the mock we map back
    // to the wire shape with a reasonable underlying status guess.
    return FIXTURE_CONVERSATIONS.filter((c) => {
      const isResolved = c.status === 'landed' || c.status === 'discarded' || c.status === 'error';
      if (!isResolved) return false;
      if (statusFilter === 'landed' && c.status !== 'landed') return false;
      if (statusFilter === 'discarded' && c.status !== 'discarded' && c.status !== 'error')
        return false;
      const haystacks = [c.title, c.lastMessage, c.anchor.loc, c.anchor.selector, c.branch];
      return haystacks.some((h) => h.toLowerCase().includes(trimmed));
    }).map((c): HistorySearchHit => {
      const matched: HistoryMatchedField[] = [];
      if (c.title.toLowerCase().includes(trimmed) || c.lastMessage.toLowerCase().includes(trimmed))
        matched.push('comment');
      if (c.branch.toLowerCase().includes(trimmed)) matched.push('branch');
      if (c.anchor.loc.toLowerCase().includes(trimmed)) matched.push('anchor');
      if (c.anchor.selector.toLowerCase().includes(trimmed)) matched.push('selector');
      // Mock doesn't track `note`; only the four fields above match here.
      const snippetSource = c.lastMessage.toLowerCase().includes(trimmed) ? c.lastMessage : c.title;
      const idx = snippetSource.toLowerCase().indexOf(trimmed);
      const start = Math.max(0, idx - 40);
      const end = Math.min(snippetSource.length, idx + trimmed.length + 40);
      const prefix = start > 0 ? '…' : '';
      const suffix = end < snippetSource.length ? '…' : '';
      return {
        id: c.id,
        comment: c.lastMessage,
        status: c.status === 'discarded' ? 'wontfix' : 'fixed',
        worktreeState:
          c.status === 'landed' ? 'landed' : c.status === 'discarded' ? 'discarded' : 'none',
        branch: c.branch,
        file: c.anchor.loc.split(':')[0] ?? null,
        line: null,
        col: null,
        selector: c.anchor.selector,
        url: c.page,
        createdAt: c.updatedAt,
        updatedAt: c.updatedAt,
        resolvedAt: c.updatedAt,
        matchedFields: matched.length > 0 ? matched : ['comment'],
        snippet: matched.includes('comment')
          ? `${prefix}${snippetSource.slice(start, end)}${suffix}`
          : '',
      };
    });
  }

  async listAuditEvents(opts: ListAuditEventsQuery = {}): Promise<AuditEvent[]> {
    await sleep(SIMULATED_LATENCY_MS);
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const filtered = opts.conversationId
      ? FIXTURE_AUDIT_EVENTS.filter((e) => e.conversationId === opts.conversationId)
      : FIXTURE_AUDIT_EVENTS;
    return filtered.slice(offset, offset + limit);
  }
}

// Synthetic audit feed for the fixtures preview. Derived from the
// FIXTURE_CONVERSATIONS list so the timeline lines up with the rows the
// dock already shows. Newest first.
const FIXTURE_AUDIT_EVENTS: AuditEvent[] = (() => {
  const events: AuditEvent[] = [];
  let nextId = 1;
  for (const c of FIXTURE_CONVERSATIONS) {
    events.push({
      id: String(nextId++),
      conversationId: c.id,
      actor: 'user',
      action: 'conversation_created',
      payload: { page: c.page, file: c.anchor.loc.split(':')[0] ?? null },
      createdAt: c.updatedAt,
    });
    if (c.status === 'landed') {
      events.push({
        id: String(nextId++),
        conversationId: c.id,
        actor: 'user',
        action: 'conversation_landed',
        payload: { branch: c.branch, target: 'main' },
        createdAt: c.updatedAt,
      });
    } else if (c.status === 'discarded') {
      events.push({
        id: String(nextId++),
        conversationId: c.id,
        actor: 'user',
        action: 'conversation_discarded',
        payload: { branch: c.branch },
        createdAt: c.updatedAt,
      });
    }
  }
  return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
})();
