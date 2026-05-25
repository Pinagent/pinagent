/**
 * Per-feedback event bus.
 *
 * Each in-flight (or recently-finished) SDK agent run owns one bus.
 * Producers (`agent.ts::consumeStream`) call `publish(event)` as SDK
 * messages arrive. Consumers (SSE subscribers in `route.ts`) call
 * `subscribe({ onEvent, onClose })` and receive (a) every event already
 * published, then (b) every event published thereafter, then (c) an
 * `onClose` callback when the run finishes.
 *
 * Late subscribers are intentional — the widget opens its EventSource
 * after the agent has already started, and a browser refresh in the
 * middle of a run should still recover the transcript so far.
 *
 * Buses are kept around for a short TTL after `markFinished` so a
 * client that connects right after the agent ends still sees the
 * outcome, then garbage-collected.
 *
 * Storage is per-process, in-memory. A dev-server restart wipes the
 * bus — and kills the SDK agent — which matches today's lifecycle
 * (Phase J in the v2 plan moves to per-turn process spawn).
 */

export type AgentEvent =
  | {
      type: 'init';
      sessionId: string;
      model: string;
      permissionMode: string;
      /**
       * Where the SDK got its credentials. `'oauth'` means a `claude login`
       * session — costs reported on the result message are notional (charged
       * against the subscription quota, not the developer's card). Any other
       * value means an explicit API key / provider auth and the cost is real.
       */
      apiKeySource: string;
    }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; summary: string }
  | { type: 'tool_result'; ok: boolean }
  | {
      /**
       * Agent paused on an `ask_user` tool call. The widget renders a form
       * for the user to answer; the answer comes back over WS as an
       * `ask_response { askId, answer }`. The tool's Promise resolves and
       * the agent continues. `askId` is the per-process correlation id.
       */
      type: 'ask_user';
      askId: string;
      question: string;
      context?: string;
      options?: string[];
    }
  | { type: 'error'; message: string }
  | {
      type: 'result';
      subtype: string;
      numTurns: number;
      totalCostUsd: number;
      durationMs: number;
      errors?: string[];
    }
  | {
      /**
       * Server-side authoritative status change. Emitted after the
       * agent's `resolve_feedback` MCP call lands in `Storage`, so
       * subscribed widgets can flip their cached row out of `pending`
       * without polling. Mirrors `FeedbackRecord.status`.
       */
      type: 'status_changed';
      status: 'pending' | 'fixed' | 'wontfix' | 'deferred';
      note: string | null;
      commitSha: string | null;
      resolvedAt: string | null;
    };

export interface BusSubscriber {
  onEvent(event: AgentEvent): void;
  onClose(): void;
}

const FINISHED_TTL_MS = 5 * 60 * 1000;

class EventBus {
  private readonly events: AgentEvent[] = [];
  private readonly subscribers = new Set<BusSubscriber>();
  private _finished = false;

  publish(event: AgentEvent): void {
    if (this._finished) return;
    this.events.push(event);
    for (const sub of this.subscribers) {
      try {
        sub.onEvent(event);
      } catch {
        // A throwing subscriber shouldn't block publishing to the rest.
      }
    }
  }

  subscribe(sub: BusSubscriber): () => void {
    // Replay buffer synchronously so the subscriber sees the
    // transcript-so-far before any live events.
    for (const e of this.events) {
      try {
        sub.onEvent(e);
      } catch {
        // Ignore — late subscribers can fail without taking the bus down.
      }
    }
    if (this._finished) {
      try {
        sub.onClose();
      } catch {
        // Ignore — subscriber's problem.
      }
      return () => {};
    }
    this.subscribers.add(sub);
    return () => this.subscribers.delete(sub);
  }

  markFinished(onEvict: () => void): void {
    if (this._finished) return;
    this._finished = true;
    for (const sub of this.subscribers) {
      try {
        sub.onClose();
      } catch {
        // Ignore; we're closing anyway.
      }
    }
    this.subscribers.clear();
    setTimeout(onEvict, FINISHED_TTL_MS);
  }
}

const buses = new Map<string, EventBus>();

export function getOrCreateBus(id: string): EventBus {
  let bus = buses.get(id);
  if (!bus) {
    bus = new EventBus();
    buses.set(id, bus);
  }
  return bus;
}

export function getBus(id: string): EventBus | undefined {
  return buses.get(id);
}

export function finishBus(id: string): void {
  const bus = buses.get(id);
  if (!bus) return;
  bus.markFinished(() => {
    buses.delete(id);
  });
}
