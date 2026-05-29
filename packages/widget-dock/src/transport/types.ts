// SPDX-License-Identifier: Apache-2.0
/**
 * DockTransport — the boundary between the dock's React tree and the
 * outside world. Today there are two implementations:
 *
 *   - LocalTransport   — talks to a running pinagent dev-server over
 *                        same-origin HTTP (proxied through Vite in dev)
 *                        plus a direct WebSocket to the WS server port.
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
 * of these, never `fetch` or `new WebSocket()` directly.
 */
import type { AgentEvent, PermissionMode, ProjectEvent } from '@pinagent/shared';
import type { Branch, Change, Conversation, PullRequest } from '../fixtures/types';
import type { ConnectionStatus, ConversationHandlers, ExtensionStatus } from './ws-client';

export interface ConversationFilters {
  /** Limit to conversations anchored to this URL. */
  page?: string;
  /** Free-text match against title + anchor location. */
  query?: string;
  /**
   * When true, archived conversations are included in the result.
   * Default false — archived rows are hidden from the active surface.
   * The dock's history view always sets this `true`.
   */
  includeArchived?: boolean;
}

export interface ConversationUpdate {
  /**
   * Title override. Pass `''` (or `null`) to clear back to the
   * comment-derived title. Server caps at 200 chars.
   */
  title?: string | null;
  archived?: boolean;
}

export interface BulkArchiveResult {
  /** Ids whose archived flag flipped to the requested value. */
  updated: string[];
  /**
   * Ids that didn't change — either the row was missing or it was
   * already at the requested archived state. Skipped is informational
   * (the dock can render "5 archived, 2 already archived"); no error.
   */
  skipped: string[];
}

/**
 * Detailed conversation read. Wider than the list-row `Conversation`
 * because the detail view needs the original user comment + the
 * screenshot for context. PR-C populates these from
 * `GET /__pinagent/feedback/:id`; mock mode synthesizes from fixtures.
 */
export interface ConversationDetail extends Conversation {
  /** Original user comment text (not truncated to title length). */
  comment: string;
  /** Base64-encoded PNG screenshot, if one was captured. */
  screenshot: string | null;
}

export interface DockTransport {
  /**
   * Distinguish transports for debug logging and dev-preview banners.
   * Not a feature flag — implementations branch on shape, not name.
   */
  readonly kind: 'local' | 'mock';

  // ---------- Reads ----------

  /** List conversations the dock should show. Newest first. */
  listConversations(filters?: ConversationFilters): Promise<Conversation[]>;

  /** Fetch the full detail for one conversation; null if not found. */
  getConversation(id: string): Promise<ConversationDetail | null>;

  /**
   * Full persisted transcript for one conversation, in order. Reads
   * from the server's append-only `messages` table without opening a
   * WebSocket — separate from `subscribeConversation`, which combines
   * replay + live events. Useful for cold loads (faster initial paint),
   * for surfaces where a WS isn't appropriate (CLI, export), and as a
   * fallback when the live socket is down. Returns [] for unknown ids.
   */
  getConversationMessages(id: string): Promise<AgentEvent[]>;

  /**
   * List per-conversation diff data for the Changes view: which
   * conversations have a worktree, how many files / lines changed,
   * etc. Newest first.
   */
  listChanges(): Promise<Change[]>;

  /**
   * Full unified diff for one conversation. Lazy-loaded when the user
   * expands a row in the Changes view. `null` when the conversation
   * isn't a worktree-state row we can diff (landed worktree gone from
   * disk, no such record, etc).
   */
  getChangeDiff(id: string): Promise<ChangeDiff | null>;

  /**
   * List every active worktree with its git cleanliness state and
   * disk usage, for the dock's Branches view. Newest activity first.
   */
  listBranches(): Promise<Branch[]>;

  /**
   * List the repo's real git branches (local heads + origin remotes) —
   * base-branch candidates for the PR composer's dropdown. Distinct from
   * {@link listBranches}, which lists pinagent's per-conversation
   * worktree branches. `[]` when the repo has none / isn't a git repo.
   */
  listGitBranches(): Promise<string[]>;

  /**
   * List GitHub PRs the dock's compose flow has opened. Driven by rows
   * the composer wrote on success — no GitHub round-trip on read.
   */
  listPullRequests(): Promise<PullRequest[]>;

  /**
   * Reconcile each recorded PR's state against GitHub and return the
   * refreshed list. Unlike {@link listPullRequests}, this does reach out
   * to the GitHub API (one call per PR); a no-op when no token /
   * non-GitHub remote is configured.
   */
  refreshPullRequests(): Promise<PullRequest[]>;

  // ---------- Live subscriptions ----------

  /**
   * Subscribe to project-wide events (new conversations, status changes,
   * worktree transitions). Used by useProjectSubscription to drive cache
   * invalidation. Returns an unsubscribe function.
   *
   * Also reports connection status so consumers can surface a
   * "Disconnected" indicator when the WS link is down.
   */
  subscribeProject(listener: (event: ProjectEvent) => void): () => void;

  /**
   * Surface WS connection status changes. Same socket powers both
   * project and conversation subscriptions, so status is global.
   */
  onConnectionStatus(listener: (status: ConnectionStatus) => void): () => void;

  /**
   * Subscribe to VSCode-extension presence. Fires with the current
   * snapshot on subscribe (once known), then on every connect/disconnect
   * transition. Drives the Connections card's installed/not-installed
   * state and the just-in-time install nudge. Returns an unsubscribe
   * function. In mock mode this reports a static "installed" snapshot.
   */
  subscribeExtensionStatus(listener: (status: ExtensionStatus) => void): () => void;

  /**
   * Subscribe to live events for one conversation — the per-feedback
   * agent event stream plus worktree-state broadcasts. The bus replays
   * the transcript-so-far synchronously, then streams live events.
   * Returns an unsubscribe function.
   */
  subscribeConversation(id: string, handlers: ConversationHandlers): () => void;

  // ---------- Writes ----------

  /** Send a follow-up user message to an in-flight conversation. */
  sendUserMessage(id: string, content: string): void;

  /**
   * Abort the in-flight SDK turn for `id`. Server-side this aborts the
   * SDK loop's AbortController (see `agent.ts.interruptRun`) and emits
   * an `error` event on the bus so subscribers update. No-op if no turn
   * is actually running — the dock should still gate the UI on the
   * derived `turnRunning` state to avoid surprises.
   */
  sendInterrupt(id: string): void;

  /**
   * Answer a specific `ask_user` tool call. Correlated by `askId` so the
   * agent's awaiting Promise resolves with the right answer even if the
   * user sent unrelated messages in between.
   */
  sendAskResponse(askId: string, answer: string): void;

  /** Land the agent's worktree onto the project's base branch. */
  landConversation(id: string): void;

  /** Throw away the agent's worktree without merging. */
  discardConversation(id: string): void;

  /**
   * Move a landed/discarded conversation back to the active list. The
   * worktree is not restored (it was cleaned up at land/discard); only
   * the lifecycle metadata is reset to `pending` / `worktreeState=none`.
   */
  reopenConversation(id: string): void;

  /**
   * Patch user-facing conversation metadata: title override + archived
   * flag. Both fields optional; passing `title: ''` clears back to the
   * comment-derived title. Returns the updated list-row shape; callers
   * should invalidate the detail-view query separately if open. Server
   * emits `conversation_renamed` / `conversation_archived` /
   * `conversation_unarchived` audit events on the transitions.
   */
  updateConversation(id: string, patch: ConversationUpdate): Promise<Conversation>;

  /**
   * Multi-row archive flip from the Conversations list's multi-select.
   * Server emits a single `conversations_bulk_archived` /
   * `conversations_bulk_unarchived` audit event naming every affected
   * id, regardless of batch size. Returns updated + skipped id arrays
   * so the UI can show "Archived 5, 2 already archived".
   */
  bulkArchive(ids: string[], archived: boolean): Promise<BulkArchiveResult>;

  /**
   * Compose multiple resolved conversations into a single PR. Server
   * creates a fresh branch off `baseBranch`, replays each selected
   * worktree's commits in order, pushes, and (if a GitHub token is
   * configured) opens the PR. Returns the PR URL on full success, or
   * `manualCompareUrl` when the push succeeded but the PR API call
   * was skipped or failed.
   */
  createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult>;

  // ---------- Connections + settings (Phase 5) ----------

  /** Presentable connection state. Never includes raw tokens. */
  getConnections(): Promise<PresentableConnections>;

  /**
   * Set or replace the GitHub personal access token. The server
   * validates it (`GET /user`) before persisting; rejects on bad token.
   */
  setGithubConnection(token: string): Promise<PresentableConnections>;

  /** Forget the stored GitHub token. */
  clearGithubConnection(): Promise<PresentableConnections>;

  /** Set or replace the Anthropic API key, validated upstream. */
  setAnthropicConnection(key: string): Promise<PresentableConnections>;

  /** Forget the stored Anthropic key. */
  clearAnthropicConnection(): Promise<PresentableConnections>;

  /** Current project config: base branch, retention, cost caps, etc. */
  getSettings(): Promise<DockProjectSettings>;

  /** Partial update; whole record echoed back. */
  updateSettings(patch: Partial<DockProjectSettings>): Promise<DockProjectSettings>;

  // ---------- Branches (Phase 4) ----------

  /**
   * Tear down one worktree + branch by conversation id. Same lifecycle
   * as `discardConversation`, but awaitable so the Branches view can
   * surface pending + error states instead of fire-and-forget.
   */
  pruneBranch(feedbackId: string): Promise<void>;

  /**
   * Stand up (or reuse) an on-demand dev server rooted at this worktree
   * and return its loadable URL, so the Branches view's "Open app" action
   * can open the worktree's running app in a browser tab. Worktree mode
   * only; rejects with the server's message when no command can be
   * resolved or the server fails to start.
   */
  serveBranch(feedbackId: string): Promise<ServeBranchResult>;

  /**
   * List the on-demand worktree dev servers currently running (from the
   * server's serve registry). Backs the worktree switcher so it knows
   * which worktrees already have a live app to preview, without having to
   * (re)start one. Returns `[]` when none are running.
   */
  listWorktreeServers(): Promise<WorktreeServer[]>;

  /**
   * Stop the on-demand dev server for one worktree (frees its port; the
   * worktree itself is untouched). Idempotent — stopping a worktree with
   * no running server resolves without error.
   */
  stopWorktreeServer(feedbackId: string): Promise<void>;

  /**
   * Bulk-prune every worktree older than the project's configured
   * `worktreeRetentionDays`. Returns the per-row outcome so the UI can
   * report "pruned 5, 1 failed".
   */
  pruneStaleBranches(): Promise<PruneStaleResult>;

  /**
   * Bulk-prune a hand-picked batch of worktrees from the Branches
   * view's multi-select. Returns `{ pruned, failed }`; the server
   * emits a single `worktrees_bulk_pruned` audit event covering the
   * batch (per-row `conversation_discarded` events still fire from
   * the worktree teardown).
   */
  bulkPruneBranches(feedbackIds: string[]): Promise<BulkPruneResult>;

  /**
   * Bulk re-open a hand-picked batch of resolved conversations from
   * the History view's multi-select. Returns `{ reopened, failed }`;
   * the server emits a single `conversations_bulk_reopened` audit
   * event covering the batch (per-row `conversation_reopened` events
   * still fire from `reopenConversation`).
   */
  bulkReopenConversations(feedbackIds: string[]): Promise<BulkReopenResult>;

  // ---------- History (Phase 6) ----------

  /**
   * Full-text search over resolved conversations. Returns the matching
   * rows + which columns matched + a short snippet around comment
   * matches. Empty query returns []; the dock falls back to the
   * client-side filter over the conversations cache in that case.
   */
  searchHistory(query: HistorySearchQuery): Promise<HistorySearchHit[]>;

  /**
   * Chronological feed of meaningful project actions (conversation
   * created, landed, discarded; PR opened). Newest first. Backs the
   * dock's History → Activity tab.
   */
  listAuditEvents(opts?: ListAuditEventsQuery): Promise<AuditEvent[]>;
}

export interface ListAuditEventsQuery {
  /** Max rows. Server caps at 500; default 100. */
  limit?: number;
  /** Pagination offset; pairs with `limit`. */
  offset?: number;
  /** Drill down to one conversation's history. */
  conversationId?: string;
}

/**
 * Action discriminator. Open set — the server can emit actions the dock
 * doesn't render specifically; those fall back to a generic label.
 * Kept here (not in @pinagent/shared) because it documents the dock's
 * rendering contract, not the wire format.
 */
export type AuditAction =
  | 'conversation_created'
  | 'conversation_landed'
  | 'conversation_discarded'
  | 'pr_created';

// AuditEvent + AuditActor live in @pinagent/shared (dock-api). Re-export
// here so the rest of the dock keeps importing them from '../transport'.
import type {
  AuditActor as SharedAuditActor,
  AuditEvent as SharedAuditEvent,
} from '@pinagent/shared';
export type AuditActor = SharedAuditActor;
export type AuditEvent = SharedAuditEvent;

export interface PruneStaleResult {
  pruned: string[];
  failed: { feedbackId: string; error: string }[];
  retentionDays: number;
}

export interface BulkPruneResult {
  pruned: string[];
  failed: { feedbackId: string; error: string }[];
}

export interface ServeBranchResult {
  url: string;
  port: number;
  /** True when an already-running server for this worktree was reused. */
  reused: boolean;
}

export interface WorktreeServer {
  /** Conversation id of the worktree this server is rooted in. */
  feedbackId: string;
  port: number;
  /** Loadable app URL, e.g. `http://localhost:53700`. */
  url: string;
  /** `'starting'` until the port answers, then `'running'`. */
  status: 'starting' | 'running';
}

export interface BulkReopenResult {
  reopened: string[];
  failed: { feedbackId: string; error: string }[];
}

export interface HistorySearchQuery {
  query: string;
  status?: 'all' | 'landed' | 'discarded';
}

// HistoryMatchedField + HistorySearchHit live in @pinagent/shared (dock-api).
// Re-export here so existing imports from '../transport' keep working.
import type {
  HistoryMatchedField as SharedHistoryMatchedField,
  HistorySearchHit as SharedHistorySearchHit,
} from '@pinagent/shared';
export type HistoryMatchedField = SharedHistoryMatchedField;
export type HistorySearchHit = SharedHistorySearchHit;

export interface ChangeDiff {
  /** Unified diff text. Possibly truncated — see `truncated`. */
  diff: string;
  /** True when the server cut the diff short to keep payloads bounded. */
  truncated: boolean;
}

export interface PresentableConnections {
  github: { connected: boolean; login: string | null };
  anthropic: { keySet: boolean };
}

/**
 * Mirrors `@pinagent/agent-runner.ProjectSettings`. Kept local to the
 * dock so the bundle doesn't pull Node-only deps. Defined here rather
 * than in fixtures/types.ts so the type evolves with the transport.
 *
 * Drift hazard: `DockProjectSettingsSchema` in `@pinagent/shared` is
 * the runtime parser the LocalTransport actually uses to validate
 * `GET /__pinagent/settings`. Keep these two declarations in sync — a
 * new schema field that's missing here will silently strip from the
 * static type and consumers won't see it.
 */
export interface DockProjectSettings {
  baseBranch: string;
  worktreeRetentionDays: number;
  perConversationCapUsd: number;
  monthlyBudgetUsd: number | null;
  permissionMode: PermissionMode;
  /**
   * Server-derived read-only flag. Non-null when
   * `PINAGENT_AGENT_PERMISSION_MODE` is set on the dev server and
   * therefore overrides `permissionMode` at spawn time. The value is
   * the resolved SDK mode (e.g. `'plan'`, `'acceptEdits'`).
   */
  permissionModeOverride: string | null;
}

export interface CreatePullRequestInput {
  feedbackIds: string[];
  branchName: string;
  title: string;
  description: string;
  baseBranch: string;
}

export interface CreatePullRequestResult {
  ok: boolean;
  /** Final PR URL when Octokit opened one. */
  prUrl?: string;
  /** True if the push succeeded — set even when the PR API call wasn't made. */
  branchPushed: boolean;
  /** When set, the user can click this to open the PR manually on GitHub. */
  manualCompareUrl?: string;
  /** Human-readable failure reason. Set when `ok` is false. */
  error?: string;
  /** Files in conflict when the failure was a merge conflict. */
  conflicts?: { feedbackId: string; files: string[] };
}
