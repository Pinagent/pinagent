// SPDX-License-Identifier: Apache-2.0
/**
 * LocalTransport — talks to a same-origin pinagent dev-server.
 *
 * In dev, the dock runs on its own Vite server (port 5174) and proxies
 * `/__pinagent/*` to the host app's dev-server (vite-plugin or
 * next-plugin middleware) where the storage layer + WS server actually
 * live. The Vite proxy is configured in this package's vite.config.ts.
 *
 * Production / embedded contexts will swap in a different transport;
 * this implementation only assumes "same origin /__pinagent/feedback
 * returns FeedbackRecord[]".
 */
import {
  AuditEventSchema,
  ChangeDiffSchema,
  DockProjectSettingsSchema,
  HistorySearchHitSchema,
  PresentableConnectionsSchema,
  type ProjectEvent,
  PruneStaleResultSchema,
} from '@pinagent/shared';
import { z } from 'zod';
import type { Branch, Change, Conversation, PullRequest } from '../fixtures/types';
import { resolveWsUrl } from '../lib/ws-url';
import { deriveDockStatus } from './status-derive';
import type {
  AuditEvent,
  BulkArchiveResult,
  BulkPruneResult,
  ChangeDiff,
  ConversationDetail,
  ConversationFilters,
  ConversationUpdate,
  CreatePullRequestInput,
  CreatePullRequestResult,
  DockProjectSettings,
  DockTransport,
  HistorySearchHit,
  HistorySearchQuery,
  ListAuditEventsQuery,
  PresentableConnections,
  PruneStaleResult,
} from './types';
import { type ConnectionStatus, type ConversationHandlers, DockWsClient } from './ws-client';

/**
 * Wire shape for `GET /__pinagent/prs`. Mirrors
 * `@pinagent/agent-runner.PullRequestRecord`. PR list-row only — no PR
 * body / diff. Server orders newest-first by `updatedAt`.
 *
 * Local schema (not shared) because the dock drops `body` + `createdAt`
 * before storing; the display PullRequest shape is the narrower one.
 */
const PullRequestWireSchema = z
  .object({
    id: z.string(),
    number: z.number().int(),
    url: z.string(),
    branch: z.string(),
    baseBranch: z.string(),
    title: z.string(),
    body: z.string(),
    state: z.enum(['open', 'merged', 'closed', 'draft']),
    conversationIds: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .loose();

/**
 * Wire shape for `GET /__pinagent/branches`. Mirrors
 * `@pinagent/agent-runner.BranchRecord`. Local because the wire's
 * `conversationId` is always non-null but the display type (`Branch`)
 * widens to nullable for inline-mode rows the dock surfaces elsewhere.
 */
const BranchWireSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    conversationId: z.string(),
    conversationTitle: z.string().nullable(),
    createdAt: z.string(),
    lastActivity: z.string(),
    state: z.enum(['clean', 'uncommitted', 'behind-base']),
    diskMb: z.number().nullable(),
  })
  .loose();

/**
 * Wire shape for `GET /__pinagent/changes`. Mirrors
 * `@pinagent/agent-runner.ChangeRecord`. Local because the display
 * `Change` adds a `preview` field the list endpoint doesn't populate
 * (fetched lazily via getChangeDiff when a row expands).
 */
const ChangeWireSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    conversationTitle: z.string(),
    status: z.enum(['pending', 'readyToLand', 'landed', 'error']),
    branch: z.string(),
    filesChanged: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    // Default for clients hitting a server that predates the flag —
    // they shouldn't get a parse error just because the field is
    // missing. Real servers always send it (true | false).
    externallyModified: z.boolean().default(false),
    updatedAt: z.string(),
  })
  .loose();

/**
 * Wire shape for `GET /__pinagent/feedback[/:id]`. Mirrors
 * `@pinagent/agent-runner.FeedbackRecord`. The transform to the dock's
 * display `Conversation` (title derived from comment, status derived
 * from status + worktreeState, etc.) lives in `toConversation` below.
 * Local because that transform is LocalTransport-specific.
 */
const FeedbackRecordSchema = z
  .object({
    id: z.string(),
    comment: z.string(),
    file: z.string().nullable(),
    line: z.number().nullable(),
    col: z.number().nullable(),
    selector: z.string(),
    url: z.string(),
    status: z.enum(['pending', 'fixed', 'wontfix', 'deferred']),
    worktreeState: z.enum(['none', 'active', 'landed', 'discarded']),
    branch: z.string().nullable(),
    // Title override + archive flag (Phase 7d). Defaults so a dock
    // built against an older server still parses.
    title: z.string().nullable().default(null),
    archived: z.boolean().default(false),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .loose();
type FeedbackRecord = z.infer<typeof FeedbackRecordSchema>;

const FeedbackRecordWithScreenshotSchema = FeedbackRecordSchema.extend({
  screenshot: z.string().nullable(),
}).loose();

/**
 * Wire shape for `POST /__pinagent/feedback/bulk-update`. Mirrors the
 * server-side BulkArchiveResult shape in @pinagent/agent-runner. Local
 * because the bulk endpoint is dock-specific.
 */
const BulkArchiveResultSchema = z
  .object({
    updated: z.array(z.string()),
    skipped: z.array(z.string()),
  })
  .loose();

/**
 * Wire shape for `POST /__pinagent/branches/bulk-prune`. Mirrors the
 * server-side BulkPruneResult shape in @pinagent/agent-runner — same
 * row structure as PruneStaleResult minus the retentionDays echo.
 */
const BulkPruneResultSchema = z
  .object({
    pruned: z.array(z.string()),
    failed: z.array(
      z
        .object({
          feedbackId: z.string(),
          error: z.string(),
        })
        .loose(),
    ),
  })
  .loose();

function locString(file: string | null, line: number | null, col: number | null): string {
  if (!file) return '';
  if (line == null) return file;
  if (col == null) return `${file}:${line}`;
  return `${file}:${line}:${col}`;
}

function shortId(id: string): string {
  return id.length > 8 ? `cv_${id.slice(0, 4)}` : `cv_${id}`;
}

function commentToTitle(comment: string): string {
  // Same heuristic the dock fixtures use: collapse to first ~80 chars
  // of the first non-empty line.
  const firstLine = comment.split('\n').find((l) => l.trim().length > 0) ?? comment;
  const trimmed = firstLine.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function toConversation(rec: FeedbackRecord): Conversation {
  return {
    id: rec.id,
    shortId: shortId(rec.id),
    // User-supplied title wins over the comment-derived one.
    title: rec.title ?? commentToTitle(rec.comment),
    status: deriveDockStatus(rec.status, rec.worktreeState),
    page: rec.url,
    anchor: {
      loc: locString(rec.file, rec.line, rec.col),
      selector: rec.selector,
      snippet: '',
    },
    branch: rec.branch ?? '',
    archived: rec.archived,
    updatedAt: rec.updatedAt,
    // Without a separate "latest agent message" query, the human's
    // original comment is the best preview we have for the list row.
    lastMessage: commentToTitle(rec.comment),
    // The list endpoint doesn't return per-row message counts; PR-C
    // adds a detail-level read. List view hides count when 0.
    messageCount: 0,
  };
}

export class LocalTransport implements DockTransport {
  readonly kind = 'local' as const;

  /**
   * Single multiplexed WS connection shared by every subscription.
   * Lazily created on first subscribe; idle-closed when nothing's
   * listening. Reused across project + per-conversation subs so the
   * dock only ever opens one socket against the dev-server.
   */
  private wsClient: DockWsClient | null = null;

  constructor(private readonly origin = '') {}

  private url(path: string): string {
    return `${this.origin}${path}`;
  }

  private ws(): DockWsClient | null {
    if (this.wsClient) return this.wsClient;
    const url = resolveWsUrl();
    if (!url) return null;
    this.wsClient = new DockWsClient(url);
    return this.wsClient;
  }

  async listConversations(filters?: ConversationFilters): Promise<Conversation[]> {
    const records = await this.jsonGetValidated(
      '/__pinagent/feedback',
      z.array(FeedbackRecordSchema),
    );
    const conversations = records.map(toConversation);

    // Filtering happens client-side because the list endpoint is small
    // (a project's lifetime conversation count) and the dock doesn't
    // benefit from a network round-trip per filter change.
    return conversations
      .filter((c) => !filters?.page || c.page === filters.page)
      .filter((c) => filters?.includeArchived || !c.archived)
      .filter((c) => {
        if (!filters?.query) return true;
        const q = filters.query.toLowerCase();
        return c.title.toLowerCase().includes(q) || c.anchor.loc.toLowerCase().includes(q);
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async listChanges(): Promise<Change[]> {
    const wire = await this.jsonGetValidated('/__pinagent/changes', z.array(ChangeWireSchema));
    return wire.map(
      (w): Change => ({
        id: w.id,
        conversationId: w.conversationId,
        conversationTitle: w.conversationTitle,
        status: w.status,
        branch: w.branch,
        filesChanged: w.filesChanged,
        additions: w.additions,
        deletions: w.deletions,
        externallyModified: w.externallyModified,
        // Inline diff lives in /__pinagent/changes/:id/diff and is
        // fetched lazily when the row is expanded — the list endpoint
        // intentionally stays lightweight.
        preview: '',
        updatedAt: w.updatedAt,
      }),
    );
  }

  async getChangeDiff(id: string): Promise<ChangeDiff | null> {
    const response = await fetch(this.url(`/__pinagent/changes/${encodeURIComponent(id)}/diff`), {
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Pinagent dev-server returned ${response.status} ${response.statusText}`);
    }
    return ChangeDiffSchema.parse(await response.json());
  }

  async listBranches(): Promise<Branch[]> {
    const wire = await this.jsonGetValidated('/__pinagent/branches', z.array(BranchWireSchema));
    return wire.map(
      (w): Branch => ({
        id: w.id,
        name: w.name,
        conversationId: w.conversationId,
        conversationTitle: w.conversationTitle,
        createdAt: w.createdAt,
        lastActivity: w.lastActivity,
        state: w.state,
        diskMb: w.diskMb,
      }),
    );
  }

  async listPullRequests(): Promise<PullRequest[]> {
    const wire = await this.jsonGetValidated('/__pinagent/prs', z.array(PullRequestWireSchema));
    return wire.map(
      (w): PullRequest => ({
        id: w.id,
        number: w.number,
        title: w.title,
        state: w.state,
        branch: w.branch,
        baseBranch: w.baseBranch,
        url: w.url,
        updatedAt: w.updatedAt,
        conversationIds: w.conversationIds,
      }),
    );
  }

  async getConversation(id: string): Promise<ConversationDetail | null> {
    const response = await fetch(this.url(`/__pinagent/feedback/${encodeURIComponent(id)}`), {
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Pinagent dev-server returned ${response.status} ${response.statusText}`);
    }
    const rec = FeedbackRecordWithScreenshotSchema.parse(await response.json());
    return {
      ...toConversation(rec),
      comment: rec.comment,
      screenshot: rec.screenshot ?? null,
    };
  }

  subscribeProject(listener: (event: ProjectEvent) => void): () => void {
    const client = this.ws();
    if (!client) return () => {};
    return client.subscribeProject(listener);
  }

  onConnectionStatus(listener: (status: ConnectionStatus) => void): () => void {
    const client = this.ws();
    if (!client) {
      listener('idle');
      return () => {};
    }
    return client.onStatusChange(listener);
  }

  subscribeConversation(id: string, handlers: ConversationHandlers): () => void {
    const client = this.ws();
    if (!client) return () => {};
    return client.subscribeConversation(id, handlers);
  }

  sendUserMessage(id: string, content: string): void {
    this.ws()?.sendUserMessage(id, content);
  }

  sendAskResponse(askId: string, answer: string): void {
    this.ws()?.sendAskResponse(askId, answer);
  }

  landConversation(id: string): void {
    this.ws()?.sendLandRequest(id);
  }

  discardConversation(id: string): void {
    this.ws()?.sendDiscardRequest(id);
  }

  reopenConversation(id: string): void {
    this.ws()?.sendReopenRequest(id);
  }

  async updateConversation(id: string, patch: ConversationUpdate): Promise<Conversation> {
    const rec = await this.jsonWriteValidated(
      'PATCH',
      `/__pinagent/feedback/${encodeURIComponent(id)}`,
      FeedbackRecordSchema,
      patch,
    );
    return toConversation(rec);
  }

  async bulkArchive(ids: string[], archived: boolean): Promise<BulkArchiveResult> {
    return this.jsonWriteValidated(
      'POST',
      '/__pinagent/feedback/bulk-update',
      BulkArchiveResultSchema,
      { ids, patch: { archived } },
    );
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
    const response = await fetch(this.url('/__pinagent/prs'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input),
    });
    // The server returns the ComposeResult shape on both 200 (ok) and
    // 422 (validation / composer failure). Anything else is unexpected.
    if (response.status === 200 || response.status === 422) {
      return (await response.json()) as CreatePullRequestResult;
    }
    if (response.status === 400) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        branchPushed: false,
        error: body.error ?? `Bad request (${response.status})`,
      };
    }
    throw new Error(`Pinagent dev-server returned ${response.status} ${response.statusText}`);
  }

  async getConnections(): Promise<PresentableConnections> {
    return this.jsonGetValidated('/__pinagent/connections', PresentableConnectionsSchema);
  }

  async setGithubConnection(token: string): Promise<PresentableConnections> {
    return this.jsonWriteValidated(
      'PUT',
      '/__pinagent/connections/github',
      PresentableConnectionsSchema,
      { token },
    );
  }

  async clearGithubConnection(): Promise<PresentableConnections> {
    return this.jsonWriteValidated(
      'DELETE',
      '/__pinagent/connections/github',
      PresentableConnectionsSchema,
    );
  }

  async setAnthropicConnection(key: string): Promise<PresentableConnections> {
    return this.jsonWriteValidated(
      'PUT',
      '/__pinagent/connections/anthropic',
      PresentableConnectionsSchema,
      { key },
    );
  }

  async clearAnthropicConnection(): Promise<PresentableConnections> {
    return this.jsonWriteValidated(
      'DELETE',
      '/__pinagent/connections/anthropic',
      PresentableConnectionsSchema,
    );
  }

  async getSettings(): Promise<DockProjectSettings> {
    return this.jsonGetValidated('/__pinagent/settings', DockProjectSettingsSchema);
  }

  async updateSettings(patch: Partial<DockProjectSettings>): Promise<DockProjectSettings> {
    return this.jsonWriteValidated(
      'PATCH',
      '/__pinagent/settings',
      DockProjectSettingsSchema,
      patch,
    );
  }

  async pruneBranch(feedbackId: string): Promise<void> {
    const response = await fetch(
      this.url(`/__pinagent/branches/${encodeURIComponent(feedbackId)}`),
      { method: 'DELETE', headers: { Accept: 'application/json' } },
    );
    if (response.ok) return;
    // 422 returns the structured PruneResult shape; surface its `error`.
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }

  async pruneStaleBranches(): Promise<PruneStaleResult> {
    return this.jsonWriteValidated(
      'POST',
      '/__pinagent/branches/prune-stale',
      PruneStaleResultSchema,
    );
  }

  async bulkPruneBranches(feedbackIds: string[]): Promise<BulkPruneResult> {
    return this.jsonWriteValidated(
      'POST',
      '/__pinagent/branches/bulk-prune',
      BulkPruneResultSchema,
      { feedbackIds },
    );
  }

  async searchHistory(query: HistorySearchQuery): Promise<HistorySearchHit[]> {
    const params = new URLSearchParams();
    params.set('q', query.query);
    if (query.status) params.set('status', query.status);
    return this.jsonGetValidated(
      `/__pinagent/history?${params.toString()}`,
      z.array(HistorySearchHitSchema),
    );
  }

  async listAuditEvents(opts: ListAuditEventsQuery = {}): Promise<AuditEvent[]> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    if (opts.conversationId) params.set('conversationId', opts.conversationId);
    const qs = params.toString();
    return this.jsonGetValidated(
      `/__pinagent/audit-log${qs ? `?${qs}` : ''}`,
      z.array(AuditEventSchema),
    );
  }

  /**
   * Schema-validated GET. Parses the body through a zod schema before
   * returning so wire drift surfaces as a thrown `ZodError` instead of
   * letting an `as T` cast paper over a renamed field downstream.
   * Errors carry the upstream body so the UI can show "GitHub rejected
   * the token: <message>" instead of just "422".
   */
  private async jsonGetValidated<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await fetch(this.url(path), { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Pinagent dev-server returned ${response.status} ${response.statusText}`);
    }
    const raw: unknown = await response.json();
    return schema.parse(raw);
  }

  /**
   * Schema-validated write. Same shape as `jsonGetValidated` for PUT /
   * PATCH / POST / DELETE — server returns the post-mutation resource,
   * dock parses with the same schema it uses on the read side.
   */
  private async jsonWriteValidated<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(this.url(path), {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) {
      const raw: unknown = await response.json();
      return schema.parse(raw);
    }
    const parsed = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(parsed.error ?? `${response.status} ${response.statusText}`);
  }
}
