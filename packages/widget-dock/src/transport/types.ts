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
import type { ProjectEvent } from '@pinagent/shared';
import type { Branch, Change, Conversation } from '../fixtures/types';
import type { ConnectionStatus, ConversationHandlers } from './ws-client';

export interface ConversationFilters {
  /** Limit to conversations anchored to this URL. */
  page?: string;
  /** Free-text match against title + anchor location. */
  query?: string;
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
   * Bulk-prune every worktree older than the project's configured
   * `worktreeRetentionDays`. Returns the per-row outcome so the UI can
   * report "pruned 5, 1 failed".
   */
  pruneStaleBranches(): Promise<PruneStaleResult>;
}

export interface PruneStaleResult {
  pruned: string[];
  failed: { feedbackId: string; error: string }[];
  retentionDays: number;
}

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
 */
export interface DockProjectSettings {
  baseBranch: string;
  worktreeRetentionDays: number;
  perConversationCapUsd: number;
  monthlyBudgetUsd: number | null;
  permissionMode: 'auto' | 'approve' | 'dry-run';
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
