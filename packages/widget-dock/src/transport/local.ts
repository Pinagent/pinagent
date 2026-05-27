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
import type { ProjectEvent } from '@pinagent/shared';
import type { Change, Conversation } from '../fixtures/types';
import { resolveWsUrl } from '../lib/ws-url';
import { deriveDockStatus } from './status-derive';
import type { ConversationDetail, ConversationFilters, DockTransport } from './types';
import { type ConnectionStatus, type ConversationHandlers, DockWsClient } from './ws-client';

/**
 * Wire shape for `GET /__pinagent/changes`. Mirrors
 * `@pinagent/agent-runner.ChangeRecord` without pulling Node-only
 * deps into the browser bundle.
 */
interface ChangeWire {
  id: string;
  conversationId: string;
  conversationTitle: string;
  status: 'pending' | 'readyToLand' | 'landed' | 'error';
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  updatedAt: string;
}

/**
 * Shape of one row from `GET /__pinagent/feedback`. Mirrors
 * `@pinagent/agent-runner.FeedbackRecord` without pulling that package
 * (and Node-only deps) into the browser bundle.
 */
interface FeedbackRecord {
  id: string;
  comment: string;
  file: string | null;
  line: number | null;
  col: number | null;
  selector: string;
  url: string;
  status: 'pending' | 'fixed' | 'wontfix' | 'deferred';
  worktreeState: 'none' | 'active' | 'landed' | 'discarded';
  branch: string | null;
  createdAt: string;
  updatedAt: string;
}

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
    title: commentToTitle(rec.comment),
    status: deriveDockStatus(rec.status, rec.worktreeState),
    page: rec.url,
    anchor: {
      loc: locString(rec.file, rec.line, rec.col),
      selector: rec.selector,
      snippet: '',
    },
    branch: rec.branch ?? '',
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
    const response = await fetch(this.url('/__pinagent/feedback'), {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Pinagent dev-server returned ${response.status} ${response.statusText}`);
    }
    const records = (await response.json()) as FeedbackRecord[];
    const conversations = records.map(toConversation);

    // Filtering happens client-side because the list endpoint is small
    // (a project's lifetime conversation count) and the dock doesn't
    // benefit from a network round-trip per filter change.
    return conversations
      .filter((c) => !filters?.page || c.page === filters.page)
      .filter((c) => {
        if (!filters?.query) return true;
        const q = filters.query.toLowerCase();
        return c.title.toLowerCase().includes(q) || c.anchor.loc.toLowerCase().includes(q);
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async listChanges(): Promise<Change[]> {
    const response = await fetch(this.url('/__pinagent/changes'), {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Pinagent dev-server returned ${response.status} ${response.statusText}`);
    }
    const wire = (await response.json()) as ChangeWire[];
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
        // Inline diff preview comes in PR-D3; empty for now.
        preview: '',
        updatedAt: w.updatedAt,
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
    const rec = (await response.json()) as FeedbackRecord & { screenshot: string | null };
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

  landConversation(id: string): void {
    this.ws()?.sendLandRequest(id);
  }

  discardConversation(id: string): void {
    this.ws()?.sendDiscardRequest(id);
  }
}
