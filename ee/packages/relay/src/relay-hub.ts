// SPDX-License-Identifier: Elastic-2.0
import {
  type ClientMessage,
  ClientMessageSchema,
  type ServerMessage,
  ServerMessageSchema,
} from '@pinagent/shared';

/**
 * Minimal transport abstraction over a single WebSocket. The Cloudflare
 * Durable Object adapter wraps `workerd`'s `WebSocket` in this shape; the
 * tests wrap an in-memory fake. Keeping the hub runtime-agnostic is what
 * lets the routing logic be unit-tested without spinning up `workerd`.
 */
export interface RelaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RelayLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Per-client subscription state, serialized onto the WebSocket attachment
 * so it survives Durable Object hibernation. See `relay-do.ts`.
 */
export interface ClientAttachment {
  feedbackIds: string[];
  project: boolean;
}

interface ClientState {
  socket: RelaySocket;
  feedbackIds: Set<string>;
  project: boolean;
}

/**
 * The heart of the relay. One hub per tenant session.
 *
 * On one side sits a single *device* socket — the developer machine's
 * `agent-runner`, which dials out to the relay (works behind NAT, no
 * inbound port). On the other side sit N *client* sockets — browser
 * widgets and hosted docks.
 *
 * The relay is a transparent pass-through of the existing wire protocol
 * (`@pinagent/shared` `ClientMessage` / `ServerMessage`) with one job the
 * local server never had to do: **demultiplex**. The agent-runner sees a
 * single socket, so the relay must
 *
 *   - reference-count `subscribe`/`unsubscribe` across clients and forward
 *     to the device only on the 0→1 and 1→0 edges, and
 *   - route each `feedbackId`-tagged server frame back to exactly the
 *     clients subscribed to that feedback.
 *
 * It deliberately does not interpret message *contents* — auth, billing,
 * and audit hang off the connection boundary (see `worker.ts`), not the
 * message stream.
 */
export class RelayHub {
  private device: RelaySocket | null = null;
  private readonly clients = new Map<RelaySocket, ClientState>();
  /** feedbackId → number of clients currently subscribed. */
  private readonly feedbackRefcount = new Map<string, number>();
  private projectRefcount = 0;

  constructor(private readonly log: RelayLogger = console) {}

  get hasDevice(): boolean {
    return this.device !== null;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  // ---------- device side ----------

  /**
   * Attach a freshly-connected agent host. Any previous device socket is
   * closed (a machine reconnecting supersedes its stale connection), and
   * the new host is re-synced with everything clients are currently
   * watching so in-flight streams resume.
   */
  attachDevice(socket: RelaySocket): void {
    const previous = this.device;
    this.device = socket;
    if (previous && previous !== socket) {
      previous.close(4000, 'superseded by new device connection');
    }
    for (const feedbackId of this.feedbackRefcount.keys()) {
      socket.send(serialize({ type: 'subscribe', feedbackId }));
    }
    if (this.projectRefcount > 0) {
      socket.send(serialize({ type: 'subscribe_project' }));
    }
  }

  detachDevice(socket: RelaySocket): void {
    if (this.device === socket) this.device = null;
  }

  /**
   * Route a frame from the device to the appropriate client(s). Frames
   * that fail schema validation are dropped (and logged) rather than
   * forwarded — drift in the wire format surfaces as a missing frame, not
   * as garbage rendered into a client.
   */
  fromDevice(raw: string): void {
    const parsed = ServerMessageSchema.safeParse(safeJson(raw));
    if (!parsed.success) {
      this.log.warn('relay: dropped invalid device frame', { issues: parsed.error.issues });
      return;
    }
    const msg = parsed.data;
    const data = JSON.stringify(msg);
    switch (msg.type) {
      case 'event':
      case 'done':
      case 'worktree_state':
        this.sendToFeedbackSubscribers(msg.feedbackId, data);
        return;
      case 'project_event':
      case 'extension_status':
        this.sendToProjectSubscribers(data);
        return;
      case 'error':
        if (msg.feedbackId) this.sendToFeedbackSubscribers(msg.feedbackId, data);
        else this.broadcast(data);
        return;
      case 'pong':
        // Device-side liveness only; never forwarded to clients.
        return;
    }
  }

  // ---------- client side ----------

  attachClient(socket: RelaySocket): void {
    if (!this.clients.has(socket)) {
      this.clients.set(socket, { socket, feedbackIds: new Set(), project: false });
    }
  }

  /**
   * Route a frame from a client. Subscription frames are reference-counted
   * and forwarded to the device only on edges; everything else passes
   * straight through. `ping` is answered locally so liveness holds even
   * when the agent host is offline.
   */
  fromClient(socket: RelaySocket, raw: string): void {
    const parsed = ClientMessageSchema.safeParse(safeJson(raw));
    if (!parsed.success) {
      this.log.warn('relay: dropped invalid client frame', { issues: parsed.error.issues });
      return;
    }
    const state = this.clients.get(socket);
    if (!state) return;
    const msg = parsed.data;
    switch (msg.type) {
      case 'subscribe':
        if (!state.feedbackIds.has(msg.feedbackId)) {
          state.feedbackIds.add(msg.feedbackId);
          if (this.incFeedback(msg.feedbackId)) this.toDevice(msg, state);
        }
        return;
      case 'unsubscribe':
        if (state.feedbackIds.delete(msg.feedbackId) && this.decFeedback(msg.feedbackId)) {
          this.toDevice(msg, state);
        }
        return;
      case 'subscribe_project':
        if (!state.project) {
          state.project = true;
          if (this.projectRefcount++ === 0) this.toDevice(msg, state);
        }
        return;
      case 'unsubscribe_project':
        if (state.project) {
          state.project = false;
          if (--this.projectRefcount === 0) this.toDevice(msg, state);
        }
        return;
      case 'ping':
        state.socket.send(serialize({ type: 'pong' }));
        return;
      default:
        // user_message, ask_response, interrupt, land/discard/reopen,
        // extension_hello, query_extension — pass straight through.
        this.toDevice(msg, state);
        return;
    }
  }

  detachClient(socket: RelaySocket): void {
    const state = this.clients.get(socket);
    if (!state) return;
    for (const id of state.feedbackIds) {
      if (this.decFeedback(id))
        this.device?.send(serialize({ type: 'unsubscribe', feedbackId: id }));
    }
    if (state.project && --this.projectRefcount === 0) {
      this.device?.send(serialize({ type: 'unsubscribe_project' }));
    }
    this.clients.delete(socket);
  }

  // ---------- hibernation rehydrate ----------
  //
  // After a Durable Object wakes from hibernation the in-memory hub is
  // gone but the WebSockets (and their serialized attachments) survive.
  // These restore the hub's bookkeeping WITHOUT re-forwarding subscribes
  // to the device — the underlying connections never dropped, so the
  // agent host already knows what's subscribed.

  restoreDevice(socket: RelaySocket): void {
    this.device = socket;
  }

  restoreClient(socket: RelaySocket, attachment: ClientAttachment): void {
    const feedbackIds = new Set(attachment.feedbackIds);
    this.clients.set(socket, { socket, feedbackIds, project: attachment.project });
    for (const id of feedbackIds) this.incFeedback(id);
    if (attachment.project) this.projectRefcount++;
  }

  /** Snapshot a client's subscriptions for serialization onto its socket. */
  snapshotClient(socket: RelaySocket): ClientAttachment | null {
    const state = this.clients.get(socket);
    return state ? { feedbackIds: [...state.feedbackIds], project: state.project } : null;
  }

  // ---------- internals ----------

  private toDevice(msg: ClientMessage, from: ClientState): void {
    if (!this.device) {
      from.socket.send(serialize({ type: 'error', message: 'agent host is offline' }));
      return;
    }
    this.device.send(serialize(msg));
  }

  private incFeedback(id: string): boolean {
    const n = this.feedbackRefcount.get(id) ?? 0;
    this.feedbackRefcount.set(id, n + 1);
    return n === 0;
  }

  private decFeedback(id: string): boolean {
    const n = this.feedbackRefcount.get(id) ?? 0;
    if (n <= 1) {
      this.feedbackRefcount.delete(id);
      return n === 1;
    }
    this.feedbackRefcount.set(id, n - 1);
    return false;
  }

  private sendToFeedbackSubscribers(feedbackId: string, data: string): void {
    for (const state of this.clients.values()) {
      if (state.feedbackIds.has(feedbackId)) state.socket.send(data);
    }
  }

  private sendToProjectSubscribers(data: string): void {
    for (const state of this.clients.values()) {
      if (state.project) state.socket.send(data);
    }
  }

  private broadcast(data: string): void {
    for (const state of this.clients.values()) state.socket.send(data);
  }
}

function serialize(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
