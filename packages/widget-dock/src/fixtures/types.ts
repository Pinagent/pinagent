// SPDX-License-Identifier: Apache-2.0
/**
 * Shared types for fixture-driven dock screens. These mirror what the
 * real transport layer will return — when Phase 1 of the spec (read
 * transport + WS subscriptions) lands, swap the fixtures for real API
 * calls and these types stay valid.
 */
import type { StatusKey } from '@pinagent/ui/tokens';

/** A single conversation anchored to a DOM element on a host page. */
export interface Conversation {
  id: string;
  /** Short slug for URL display, e.g. `cv_4f2a`. */
  shortId: string;
  /**
   * Display title. User-supplied override when one is set, otherwise
   * derived from the conversation's original comment (first non-empty
   * line, ≤80 chars).
   */
  title: string;
  status: StatusKey;
  /** Page (URL or path) the original click happened on. */
  page: string;
  anchor: {
    /** `file:line:col` from data-pa-loc, e.g. `src/Hero.tsx:42:8`. */
    loc: string;
    /** Short CSS selector, e.g. `header.hero > button.cta`. */
    selector: string;
    /** Snippet of the clicked element's text/HTML. */
    snippet: string;
    /**
     * Enclosing-component context (from #166), null/undefined when the
     * app is uninstrumented or it's a single-pick non-loop element.
     * `component` is the nearest component name (`PriceCard`);
     * `instanceIndex`/`instanceTotal` locate which `.map()` item was
     * picked (0-based index, surfaced as "item N of M").
     */
    component?: string | null;
    instanceIndex?: number | null;
    instanceTotal?: number | null;
  };
  branch: string;
  /**
   * Soft-archive flag. Archived rows are hidden from the default
   * Conversations list and excluded from the FAB pending count. The
   * archive view opts in via the "Show archived" filter.
   */
  archived: boolean;
  /** ISO timestamp of the latest activity in this conversation. */
  updatedAt: string;
  /** Single-line preview of the latest agent message. */
  lastMessage: string;
  /** Number of human + agent messages in the thread. */
  messageCount: number;
  /**
   * Running USD cost for this conversation, summed from each SDK
   * `result` event's `total_cost_usd`. Server populates this in
   * `Storage.list`; fixtures supply representative values for the
   * design demo. 0 when no turn has completed yet. For OAuth
   * subscription runs this is notional (API-equivalent) — use
   * `isNotionalCost(apiKeySource)` to decide how to label it.
   */
  totalCostUsd: number;
  /**
   * Where the SDK that ran this conversation got its credentials,
   * copied from the persisted `init` event. `'oauth'` means a
   * `claude login` session, so `totalCostUsd` is notional rather than
   * a real charge. Undefined/null for rows with no recorded run (and
   * for docks talking to a server that predates this field).
   */
  apiKeySource?: string | null;
}

/** A pending or landed code change produced by an agent for a conversation. */
export interface Change {
  id: string;
  conversationId: string;
  conversationTitle: string;
  status: Extract<StatusKey, 'readyToLand' | 'pending' | 'landed' | 'error'>;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  /**
   * True when the worktree's branch has commits the agent didn't make
   * (the agent never commits — Land does it on the user's behalf). A
   * human reached into the worktree and committed manually. The dock
   * shows a "modified externally" badge on the row so the user knows
   * their off-flow edits exist before they Land or Discard.
   */
  externallyModified: boolean;
  /**
   * One-line diff preview rendered under the stats — the first `+`/`-`
   * line from the worktree's diff against base, truncated. Populated
   * server-side by `listChanges` (see `agent.ts.computeWorktreePreview`);
   * fixtures supply hand-crafted multi-line values that the `truncate`
   * CSS reduces to the first line for the design demo.
   */
  preview: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  name: string;
  conversationId: string | null;
  conversationTitle: string | null;
  createdAt: string;
  lastActivity: string;
  /** Worktree dirtiness. */
  state: 'clean' | 'uncommitted' | 'behind-base';
  /** Disk usage in MB (local mode only). */
  diskMb: number | null;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  state: 'open' | 'merged' | 'closed' | 'draft';
  branch: string;
  baseBranch: string;
  url: string;
  updatedAt: string;
  conversationIds: string[];
}

/**
 * GitHub connection state for the Connections route. Tokens never reach
 * the dock — the host stores them and serves only the presentable shape.
 */
export interface GitHubConnection {
  connected: boolean;
  account: string | null;
  /** Repositories the connection can reach. */
  repos: { name: string; private: boolean }[];
}

/** Anthropic key / managed-compute status for the Connections route. */
export interface AnthropicConnection {
  /** 'byo' = user-supplied key; 'managed' = Pro+ managed compute. */
  mode: 'byo' | 'managed' | 'unset';
  /** True only when mode='byo' and a key is on file. Never the key itself. */
  keySet: boolean;
  /** Spend this month in USD, server-aggregated. */
  monthUsageUsd: number;
  /** Monthly budget if one is configured, else null. */
  monthBudgetUsd: number | null;
}

/** Per-project configuration shown on the Settings route. */
export interface ProjectSettings {
  baseBranch: string;
  /** Days to keep an inactive worktree before pruning. */
  worktreeRetentionDays: number;
  /** Hard ceiling per conversation, in USD. */
  perConversationCapUsd: number;
  /** Soft project-wide ceiling per month, in USD. Optional. */
  monthlyBudgetUsd: number | null;
  permissionMode: 'auto' | 'approve' | 'dry-run';
}
