// SPDX-License-Identifier: Apache-2.0
/**
 * Multiplexed WebSocket client for the dock. One persistent connection
 * to the dev-server's WS endpoint carries:
 *   - the project-wide subscription (used by useProjectSubscription)
 *   - any number of per-feedback subscriptions (used by
 *     useConversationStream — each open conversation detail view).
 *
 * Mirrors the widget's `WidgetWsClient` (packages/widget/src/widget.ts)
 * — same exponential-backoff reconnect, same handler-map model, same
 * outbound message queue while disconnected. Lives in the dock package
 * rather than @pinagent/shared because we'll want to extract a shared
 * abstraction later that both widget and dock consume; until then,
 * keeping the dock copy small and dependency-free is the cheaper move.
 */

import type { AgentEvent, ProjectEvent, ServerMessage } from '@pinagent/shared';
import { ServerMessageSchema } from '@pinagent/shared';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const IDLE_CLOSE_MS = 5_000;

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface ConversationHandlers {
  onEvent(event: AgentEvent): void;
  /**
   * Phase H worktree state broadcast for this conversation. Fires on
   * subscribe (with current state), then on every land/discard/conflict
   * transition.
   */
  onWorktreeState(state: WorktreeStatePayload): void;
  onError(message: string): void;
  /** Agent bus closed (turn / run finished). */
  onDone(): void;
}

export type WorktreeStatePayload = Omit<
  Extract<ServerMessage, { type: 'worktree_state' }>,
  'type' | 'feedbackId'
>;

type StatusListener = (status: ConnectionStatus) => void;
type ProjectListener = (event: ProjectEvent) => void;

export class DockWsClient {
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = 'idle';
  private explicitlyClosed = false;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly statusListeners = new Set<StatusListener>();
  private readonly projectListeners = new Set<ProjectListener>();
  private readonly conversationHandlers = new Map<string, ConversationHandlers>();

  /** Outbound queue for messages sent while disconnected. */
  private readonly outbox: string[] = [];

  /** Whether `subscribe_project` is currently active (client-side intent). */
  private projectSubscribed = false;

  constructor(private readonly url: string) {}

  // ---------- Status ----------

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(next: ConnectionStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const l of this.statusListeners) {
      try {
        l(next);
      } catch {
        // Listener errors don't cascade.
      }
    }
  }

  // ---------- Project subscription ----------

  /** Add a project-event listener; opens the socket and subscribes if needed. */
  subscribeProject(listener: ProjectListener): () => void {
    this.projectListeners.add(listener);
    if (!this.projectSubscribed) {
      this.projectSubscribed = true;
      this.send({ type: 'subscribe_project' });
    }
    this.ensureConnected();
    return () => this.unsubscribeProjectListener(listener);
  }

  private unsubscribeProjectListener(listener: ProjectListener): void {
    this.projectListeners.delete(listener);
    if (this.projectListeners.size > 0) return;
    this.projectSubscribed = false;
    this.send({ type: 'unsubscribe_project' });
    this.maybeIdleClose();
  }

  // ---------- Per-conversation subscription ----------

  subscribeConversation(feedbackId: string, handlers: ConversationHandlers): () => void {
    this.conversationHandlers.set(feedbackId, handlers);
    this.send({ type: 'subscribe', feedbackId });
    this.ensureConnected();
    return () => this.unsubscribeConversation(feedbackId);
  }

  private unsubscribeConversation(feedbackId: string): void {
    this.conversationHandlers.delete(feedbackId);
    this.send({ type: 'unsubscribe', feedbackId });
    this.maybeIdleClose();
  }

  // ---------- Writes ----------

  sendUserMessage(feedbackId: string, content: string): void {
    this.send({ type: 'user_message', feedbackId, content });
  }

  sendAskResponse(askId: string, answer: string): void {
    this.send({ type: 'ask_response', askId, answer });
  }

  sendLandRequest(feedbackId: string): void {
    this.send({ type: 'land_request', feedbackId });
  }

  sendDiscardRequest(feedbackId: string): void {
    this.send({ type: 'discard_request', feedbackId });
  }

  /** Force-close the socket; subscriptions are preserved in state and
   *  will re-attach on the next ensureConnected. Use for app teardown. */
  close(): void {
    this.explicitlyClosed = true;
    this.clearTimers();
    if (this.socket && this.socket.readyState !== this.socket.CLOSED) {
      try {
        this.socket.close();
      } catch {
        // Closing a half-open socket; ignore.
      }
    }
    this.socket = null;
    this.setStatus('closed');
  }

  // ---------- Internals ----------

  private send(msg: object): void {
    const payload = JSON.stringify(msg);
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      try {
        this.socket.send(payload);
        return;
      } catch {
        // Socket closing mid-write; fall through to queue.
      }
    }
    this.outbox.push(payload);
    this.ensureConnected();
  }

  private ensureConnected(): void {
    if (this.socket && this.socket.readyState <= this.socket.OPEN) return;
    if (this.idleCloseTimer) {
      clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }
    this.explicitlyClosed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setStatus('connecting');
    try {
      this.socket = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket.addEventListener('open', () => this.onOpen());
    this.socket.addEventListener('message', (e) => this.onMessage(e));
    this.socket.addEventListener('close', () => this.onClose());
    this.socket.addEventListener('error', () => {
      // 'close' will follow and drive reconnect.
    });
  }

  private onOpen(): void {
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.setStatus('open');
    // Re-establish subscriptions on the fresh socket so the server's
    // per-connection state matches our client-side intent.
    if (this.projectSubscribed) {
      this.socket?.send(JSON.stringify({ type: 'subscribe_project' }));
    }
    for (const id of this.conversationHandlers.keys()) {
      this.socket?.send(JSON.stringify({ type: 'subscribe', feedbackId: id }));
    }
    // Flush queued outbound writes.
    while (this.outbox.length > 0) {
      const item = this.outbox.shift();
      if (item) this.socket?.send(item);
    }
  }

  private onMessage(event: MessageEvent): void {
    let raw: unknown;
    try {
      raw = JSON.parse(String(event.data));
    } catch {
      return;
    }
    // Validate at the boundary so a server-side wire-format drift can't
    // poison the rendering layer. Malformed frames drop silently —
    // logging would be noisy under reconnect storms. Unknown fields
    // survive (`.loose()` on each variant in the schema).
    const parsed = ServerMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const m: ServerMessage = parsed.data;
    switch (m.type) {
      case 'project_event':
        for (const l of this.projectListeners) {
          try {
            l(m.event);
          } catch {
            // Ignore individual listener errors.
          }
        }
        return;
      case 'event': {
        const h = this.conversationHandlers.get(m.feedbackId);
        if (h) {
          try {
            h.onEvent(m.event);
          } catch {
            // Ignore.
          }
        }
        return;
      }
      case 'worktree_state': {
        const h = this.conversationHandlers.get(m.feedbackId);
        if (h) {
          const { type: _type, feedbackId: _id, ...payload } = m;
          try {
            h.onWorktreeState(payload);
          } catch {
            // Ignore.
          }
        }
        return;
      }
      case 'error': {
        if (m.feedbackId) {
          const h = this.conversationHandlers.get(m.feedbackId);
          if (h) {
            try {
              h.onError(m.message);
            } catch {
              // Ignore.
            }
          }
        }
        return;
      }
      case 'done': {
        const h = this.conversationHandlers.get(m.feedbackId);
        if (h) {
          try {
            h.onDone();
          } catch {
            // Ignore.
          }
        }
        return;
      }
      case 'pong':
        return;
    }
  }

  private onClose(): void {
    this.socket = null;
    if (this.explicitlyClosed) {
      this.setStatus('closed');
      return;
    }
    if (this.projectListeners.size === 0 && this.conversationHandlers.size === 0) {
      // Nobody's listening; stay closed until someone re-subscribes.
      this.setStatus('closed');
      return;
    }
    this.setStatus('closed');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private maybeIdleClose(): void {
    if (this.projectListeners.size > 0 || this.conversationHandlers.size > 0) return;
    // Defer the close briefly so a fast re-subscribe (e.g. detail view
    // unmount → list view → click another row) doesn't churn the socket.
    if (this.idleCloseTimer) clearTimeout(this.idleCloseTimer);
    this.idleCloseTimer = setTimeout(() => {
      this.idleCloseTimer = null;
      if (this.projectListeners.size > 0 || this.conversationHandlers.size > 0) return;
      this.close();
      // Reset the explicit-closed flag so a future subscribe re-opens.
      this.explicitlyClosed = false;
    }, IDLE_CLOSE_MS);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.idleCloseTimer) {
      clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }
  }
}
