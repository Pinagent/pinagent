// SPDX-License-Identifier: Apache-2.0
/**
 * RN WebSocket client for live agent streaming.
 *
 * Connects to the same Metro host the feedback POST uses (derived from
 * `devServerBaseUrl()`), swapping the scheme to `ws(s)` and hitting
 * `/__pinagent/ws` — the endpoint the server mounts via
 * `pinagentWebsocketEndpoints` (Metro `config.server.websocketEndpoints`).
 * Because it rides Metro's own port, a physical device needs no port
 * discovery: if the bundle loaded, this URL is reachable.
 *
 * The wire protocol is the web one (`@pinagent/shared`'s ws-protocol): we send
 * `subscribe` / `user_message` / `ask_response` / `interrupt`, and receive
 * `event` / `done` / `error`. On reconnect the server replays the full
 * transcript, so we fire `onReset` first to let the UI rebuild from scratch.
 *
 * Scoped to ONE feedback id per client — the RN widget streams a single
 * conversation at a time (the one just submitted). That keeps this far smaller
 * than the web client's multiplexed map.
 */

import type { AgentEvent, ServerMessage } from './transcript';
import { devServerBaseUrl } from './transport';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8000;

export interface StreamHandlers {
  /** A reconnect is about to replay the transcript — clear and rebuild. */
  onReset(): void;
  onEvent(event: AgentEvent): void;
  /** The run's bus closed (agent finished or idle). */
  onDone(): void;
  onError(message: string): void;
}

/** Derive `ws(s)://host:port/__pinagent/ws` from Metro's bundle URL. */
export function devServerWsUrl(): string | null {
  const base = devServerBaseUrl();
  if (!base) return null;
  return `${base.replace(/^http/, 'ws')}/__pinagent/ws`;
}

export class StreamClient {
  private socket: WebSocket | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private connectedBefore = false;

  constructor(
    private readonly feedbackId: string,
    private readonly handlers: StreamHandlers,
  ) {}

  /** Open the socket and subscribe. Safe to call once per instance. */
  start(): void {
    this.closed = false;
    this.connect();
  }

  /** Tear down for good — no further reconnects. Call on unmount/dismiss. */
  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.socket?.close();
    } catch {
      // already closing
    }
    this.socket = null;
  }

  /** Queue a follow-up turn for the agent. No-op if the socket isn't open. */
  sendUserMessage(content: string): void {
    this.send({ type: 'user_message', feedbackId: this.feedbackId, content });
  }

  /** Answer an `ask_user` prompt. */
  sendAskResponse(askId: string, answer: string): void {
    this.send({ type: 'ask_response', askId, answer });
  }

  /** Interrupt the in-flight run. */
  interrupt(): void {
    this.send({ type: 'interrupt', feedbackId: this.feedbackId });
  }

  private connect(): void {
    const url = devServerWsUrl();
    if (!url) {
      this.handlers.onError('No dev server (release build?)');
      return;
    }
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      // On a reconnect the server replays the whole transcript; let the UI
      // wipe and rebuild so we don't double-render.
      if (this.connectedBefore) this.handlers.onReset();
      this.connectedBefore = true;
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.send({ type: 'subscribe', feedbackId: this.feedbackId });
    };

    socket.onmessage = (ev: { data?: unknown }) => {
      this.onMessage(ev.data);
    };

    socket.onclose = () => {
      if (this.closed) return;
      this.scheduleReconnect();
    };

    // RN fires onerror then onclose; reconnect is driven by onclose.
    socket.onerror = () => {};
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'event':
        if (msg.feedbackId === this.feedbackId && msg.event) this.handlers.onEvent(msg.event);
        break;
      case 'done':
        if (msg.feedbackId === this.feedbackId) this.handlers.onDone();
        break;
      case 'error':
        // Server scopes some errors to a feedback id; surface ours + global.
        if (!msg.feedbackId || msg.feedbackId === this.feedbackId) {
          this.handlers.onError(msg.message ?? 'unknown error');
        }
        break;
      // worktree_state / pong / project fan-out: ignored by the RN widget.
    }
  }

  private send(msg: Record<string, unknown>): void {
    const s = this.socket;
    if (!s || s.readyState !== 1 /* OPEN */) return;
    try {
      s.send(JSON.stringify(msg));
    } catch {
      // socket closing mid-write
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.connect();
    }, delay);
  }
}
