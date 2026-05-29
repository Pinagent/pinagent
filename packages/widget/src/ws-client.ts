// SPDX-License-Identifier: Apache-2.0
import { RECONNECT_MAX_MS, RECONNECT_MIN_MS } from './constants';
import type { FeedbackHandler, ServerMessage, WorktreeStateMessage } from './types';

/**
 * Single WebSocket connection per page, multiplexed across however many
 * composers exist (only one expanded at a time, but minimized bubbles
 * keep their subscriptions live so agent events keep arriving and the
 * bubble visual updates).
 */
export class WidgetWsClient {
  private socket: WebSocket | null = null;
  private readonly handlers = new Map<string, FeedbackHandler>();
  /**
   * Project-wide listeners (the running-agents tray). Distinct from
   * per-feedback `handlers`: a socket with only project listeners and no
   * per-feedback handlers must still stay open, so the close/idle gates
   * below check both sets.
   */
  private readonly projectListeners = new Set<() => void>();
  private readonly queue: string[] = [];
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitlyClosed = false;

  constructor(private readonly url: string) {}

  subscribe(feedbackId: string, handler: FeedbackHandler): void {
    this.handlers.set(feedbackId, handler);
    this.ensureConnected();
    this.send({ type: 'subscribe', feedbackId });
  }

  unsubscribe(feedbackId: string): void {
    this.handlers.delete(feedbackId);
    this.send({ type: 'unsubscribe', feedbackId });
    this.closeIfIdle();
  }

  /**
   * Subscribe to project-wide change events (`conversations_changed`).
   * Returns an unsubscribe fn. Used by the running-agents tray to refetch
   * the conversation list when anything in the project changes.
   */
  subscribeProject(listener: () => void): () => void {
    const first = this.projectListeners.size === 0;
    this.projectListeners.add(listener);
    this.ensureConnected();
    if (first) this.send({ type: 'subscribe_project' });
    return () => this.unsubscribeProject(listener);
  }

  private unsubscribeProject(listener: () => void): void {
    if (!this.projectListeners.delete(listener)) return;
    if (this.projectListeners.size === 0) {
      this.send({ type: 'unsubscribe_project' });
      this.closeIfIdle();
    }
  }

  /** Close the socket only when nothing — per-feedback or project — needs it. */
  private closeIfIdle(): void {
    if (this.handlers.size === 0 && this.projectListeners.size === 0) this.closeIdle();
  }

  sendUserMessage(feedbackId: string, content: string): void {
    this.send({ type: 'user_message', feedbackId, content });
  }

  sendAskResponse(askId: string, answer: string): void {
    this.send({ type: 'ask_response', askId, answer });
  }

  sendInterrupt(feedbackId: string): void {
    this.send({ type: 'interrupt', feedbackId });
  }

  sendLandRequest(feedbackId: string): void {
    this.send({ type: 'land_request', feedbackId });
  }

  sendDiscardRequest(feedbackId: string): void {
    this.send({ type: 'discard_request', feedbackId });
  }

  private send(msg: object): void {
    const payload = JSON.stringify(msg);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
    } else {
      this.queue.push(payload);
      this.ensureConnected();
    }
  }

  private ensureConnected(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.explicitlyClosed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.socket = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket.addEventListener('open', () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      for (const id of this.handlers.keys()) {
        this.socket?.send(JSON.stringify({ type: 'subscribe', feedbackId: id }));
      }
      // Restore the project subscription across reconnects.
      if (this.projectListeners.size > 0) {
        this.socket?.send(JSON.stringify({ type: 'subscribe_project' }));
      }
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (item) this.socket?.send(item);
      }
    });
    this.socket.addEventListener('message', (msg) => this.onMessage(msg));
    this.socket.addEventListener('close', () => {
      if (this.explicitlyClosed) return;
      if (this.handlers.size === 0 && this.projectListeners.size === 0) return;
      this.scheduleReconnect();
    });
    this.socket.addEventListener('error', () => {
      // Errors are followed by 'close' which drives reconnect.
    });
  }

  private closeIdle(): void {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.socket?.close();
    } catch {
      // Ignore.
    }
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private onMessage(msg: MessageEvent): void {
    let parsed: ServerMessage;
    try {
      parsed = JSON.parse(typeof msg.data === 'string' ? msg.data : '');
    } catch {
      return;
    }
    switch (parsed.type) {
      case 'event': {
        const id = parsed.feedbackId;
        if (!id || !parsed.event) return;
        const h = this.handlers.get(id);
        if (h) h.onEvent(parsed.event);
        return;
      }
      case 'done': {
        const id = parsed.feedbackId;
        if (!id) return;
        const h = this.handlers.get(id);
        if (h) h.onDone();
        return;
      }
      case 'error': {
        const id = parsed.feedbackId;
        const message = parsed.message ?? 'unknown error';
        if (id) {
          const h = this.handlers.get(id);
          if (h) h.onError(message);
        }
        return;
      }
      case 'worktree_state': {
        const id = parsed.feedbackId;
        const state = parsed.state;
        if (!id || !state) return;
        const h = this.handlers.get(id);
        if (h?.onWorktreeState) {
          const payload: WorktreeStateMessage = { state };
          if (parsed.commitSha) payload.commitSha = parsed.commitSha;
          if (parsed.conflicts) payload.conflicts = parsed.conflicts;
          if (parsed.message) payload.message = parsed.message;
          if (typeof parsed.changesCount === 'number') {
            payload.changesCount = parsed.changesCount;
          }
          h.onWorktreeState(payload);
        }
        return;
      }
      case 'project_event': {
        // `conversations_changed` is the only variant today; fire all
        // project listeners regardless so the tray refetches.
        for (const listener of this.projectListeners) listener();
        return;
      }
      case 'pong':
        return;
    }
  }
}
