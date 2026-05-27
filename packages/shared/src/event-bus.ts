// SPDX-License-Identifier: Apache-2.0
//
// Types only. The bus implementation lives in
// `packages/agent-runner/src/bus.ts` (SQLite-backed via `messages`
// table). This file exists so both server code (agent-runner) and
// browser code (widget) can share the AgentEvent union without
// pulling in any runtime — the widget never instantiates a bus, it
// just deserialises events arriving over WebSocket and reads cached
// rows from its sqlite-wasm mirror.
//
// Why SQLite-backed at all: in-memory storage tied to a `globalThis`
// Symbol breaks under Vite 8's environment isolation (and any other
// multi-context dev-server setup). The plugin's module gets evaluated
// twice — once per environment — and each evaluation gets its own
// `globalThis` registry. A publish in context B is invisible to a
// subscriber in context A. SQLite is the natural broker: every
// context opens the same `.pinagent/db.sqlite` and publish/subscribe
// flow through the existing `messages` table.

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
