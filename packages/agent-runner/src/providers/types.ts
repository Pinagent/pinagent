// SPDX-License-Identifier: Apache-2.0
import type { AgentEvent } from '@pinagent/shared';

/**
 * Pinagent's own permission-mode value-space, decoupled from any single
 * SDK. The Claude provider maps these onto the Claude Agent SDK's
 * `PermissionMode`; a wrapped CLI provider maps them onto whatever
 * auto-approve flags its CLI exposes (or ignores them).
 *
 * Mirrors the union the Claude SDK happens to use today, which is why the
 * mapping in `claude-code.ts` is currently the identity — but keeping our
 * own alias means a future provider can't silently break when the SDK's
 * union drifts.
 */
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/**
 * Everything a provider needs to run one turn for one feedback record.
 * Deliberately free of SDK types so a provider can be implemented against
 * any agent backend (the Claude Agent SDK, a wrapped CLI, a raw model
 * loop) without leaking that choice up into the orchestration in
 * `agent.ts`.
 */
export interface AgentRunRequest {
  /** Real project root — used to scope the bus, storage, and MCP server. */
  projectRoot: string;
  /** Conversation/feedback id this run belongs to. */
  feedbackId: string;
  /** Working directory the agent edits in (project root or a worktree). */
  cwd: string;
  /** The prompt for this turn (initial instructions or a follow-up reply). */
  prompt: string;
  /** True for the first turn of a conversation, false for follow-ups. */
  isInitial: boolean;
  /** How aggressively the agent may act without asking. */
  permissionMode: AgentPermissionMode;
  /** Prior session/thread id to resume, when the backend supports it. */
  resume?: string;
  /** Aborted by `interruptRun`; providers MUST stop work when it fires. */
  abortSignal: AbortSignal;
}

/**
 * One normalized chunk emitted by a provider as it runs. The provider's
 * job is to translate its backend's native stream into these — the
 * orchestration in `agent.ts` then handles bus publishing, transcript
 * logging, cost/session persistence, and resolution uniformly across
 * every provider.
 */
export interface ProviderRunItem {
  /**
   * Bus events to publish. These drive the widget's live stream AND the
   * persisted record cost/session/apiKeySource rollups (see storage.ts),
   * so providers should emit a well-formed `init` event (carrying
   * `sessionId`/`apiKeySource`) and a terminal `result` event (carrying
   * `totalCostUsd`/`numTurns`) for the dock's badges to populate.
   */
  events?: AgentEvent[];
  /** Markdown to append to the transcript log. Empty/undefined skips. */
  log?: string;
  /**
   * Session/thread id this chunk established. The first non-null value
   * seen in a run is persisted so follow-up turns can resume it.
   */
  sessionId?: string;
  /** Set true on the terminal chunk of the turn so the consumer finalizes. */
  isResult?: boolean;
  /**
   * Pre-rendered resolution footer for the terminal chunk. The provider
   * owns this rendering because cost/usage formatting is backend-specific
   * (e.g. the Claude provider relabels notional subscription cost).
   */
  resultFooter?: string;
}

/**
 * A pluggable agent backend. `run` is an async generator so the caller
 * can stream chunks to the widget as they arrive and abort mid-flight via
 * `req.abortSignal`.
 */
export interface AgentProvider {
  /** Stable identifier, e.g. `claude-code`, `cli`. Used in logs/telemetry. */
  readonly id: string;
  run(req: AgentRunRequest): AsyncIterable<ProviderRunItem>;
}
