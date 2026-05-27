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
  /** One-line summary of what the user asked. */
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
  };
  branch: string;
  /** ISO timestamp of the latest activity in this conversation. */
  updatedAt: string;
  /** Single-line preview of the latest agent message. */
  lastMessage: string;
  /** Number of human + agent messages in the thread. */
  messageCount: number;
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
   * Truncated diff preview for the row. PR-D3 wires the inline diff
   * renderer; for now this stays empty on real data and is just
   * populated in fixtures for the design demo.
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

/** A recent project-wide event for the Overview activity feed. */
export interface ActivityEvent {
  id: string;
  type:
    | 'conversation_created'
    | 'conversation_updated'
    | 'conversation_landed'
    | 'pr_created'
    | 'pr_merged'
    | 'worktree_pruned';
  conversationId?: string;
  conversationTitle?: string;
  prNumber?: number;
  branch?: string;
  at: string;
}
