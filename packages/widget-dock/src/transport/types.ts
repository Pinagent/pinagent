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
import type { Change, Conversation } from '../fixtures/types';
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
   * Bundle a set of conversations into a fresh branch + GitHub PR.
   * The server cherry-picks each conversation's commits onto a new
   * branch (in a throwaway worktree so the user's main checkout
   * stays clean), pushes the branch, and opens the PR via the
   * GitHub REST API.
   *
   * Throws `CreatePrTransportError` for the server's structured
   * 422 errors (missing GITHUB_TOKEN, cherry-pick conflict, push
   * failed, etc.) — the composer keys off `.code` to render
   * specific guidance. Throws a generic Error for everything else.
   */
  createPr(input: CreatePrInput): Promise<CreatePrResult>;
}

/** Wire shape mirroring `@pinagent/agent-runner.CreatePrInput`. */
export interface CreatePrInput {
  conversationIds: string[];
  title: string;
  body: string;
  branchName?: string;
  baseBranch?: string;
}

/** Wire shape mirroring `@pinagent/agent-runner.CreatePrResult`. */
export interface CreatePrResult {
  number: number;
  url: string;
  branch: string;
}

/**
 * Thrown by `transport.createPr` when the server returns a 422 with
 * a structured error code from `@pinagent/agent-runner.CreatePrError`.
 * Composer UI keys off `.code` to render specific guidance.
 */
export class CreatePrTransportError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'CreatePrTransportError';
  }
}
