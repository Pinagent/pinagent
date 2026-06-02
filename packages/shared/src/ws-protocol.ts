// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { type AgentEvent, AgentEventSchema } from './event-bus';

/**
 * Wire-format messages between the browser widget and the dev-side
 * WebSocket server.
 *
 * Validated on the server with the Zod schemas below. Client-side is
 * untyped at the wire boundary — the widget renders defensively.
 *
 * Reserved for the connection lifecycle:
 *  - `ping` / `pong`  — explicit liveness check (the `ws` library also
 *                       runs lower-level WS ping frames; this is
 *                       application-level and visible in protocol logs).
 *
 * Per-feedback subscribe/unsubscribe so one socket can multiplex
 * multiple in-flight agents — sets us up for the v2 "multiple widgets
 * per page" goal without changing the wire format.
 */

// ---------- Client → server ----------

const FeedbackId = z
  .string()
  .min(8)
  .max(16)
  .regex(/^[A-Za-z0-9_-]+$/);

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), feedbackId: FeedbackId }),
  z.object({ type: z.literal('unsubscribe'), feedbackId: FeedbackId }),
  z.object({
    type: z.literal('user_message'),
    feedbackId: FeedbackId,
    content: z.string().min(1).max(8000),
  }),
  z.object({
    type: z.literal('ask_response'),
    askId: z.string().min(1).max(64),
    answer: z.string().max(8000),
  }),
  z.object({ type: z.literal('interrupt'), feedbackId: FeedbackId }),
  /** Phase H — land the agent's worktree onto the project's HEAD branch. */
  z.object({ type: z.literal('land_request'), feedbackId: FeedbackId }),
  /** Phase H — throw away the agent's worktree without merging. */
  z.object({ type: z.literal('discard_request'), feedbackId: FeedbackId }),
  /**
   * Reverse a landed/discarded conversation: clear `worktreeState` back
   * to `none` and `status` back to `pending`. The worktree itself was
   * cleaned up at land/discard time and is NOT restored — the user is
   * just putting the conversation back in the active list so they can
   * follow up with the agent.
   */
  z.object({ type: z.literal('reopen_request'), feedbackId: FeedbackId }),
  /**
   * Dock subscribers (project-wide). One socket gets fan-out of every
   * conversation-list-affecting change in the project: new submissions,
   * status patches, worktree landings, discards. Used by the dock to
   * invalidate its TanStack Query cache without polling.
   */
  z.object({ type: z.literal('subscribe_project') }),
  z.object({ type: z.literal('unsubscribe_project') }),
  /**
   * Sent by the VSCode extension when it activates. Marks this socket as
   * the editor-side bridge so the server can broadcast presence to dock
   * subscribers — that's how the dock knows whether to nudge the user to
   * install the extension. `version` is the extension's package version,
   * surfaced in the dock's Connections card.
   */
  z.object({ type: z.literal('extension_hello'), version: z.string().max(32).optional() }),
  /**
   * Dock asks for the current extension-presence snapshot. The server
   * also pushes `extension_status` automatically on `subscribe_project`,
   * so this is mostly a belt-and-suspenders for sockets that only want
   * presence without the full project fan-out.
   */
  z.object({ type: z.literal('query_extension') }),
  /**
   * Push the cloud's branch-routing policy down to this dev server, which
   * applies it to local project settings (`baseBranch` + `allowedBranchPatterns`,
   * enforced in agent-runner's `worktree.ts`). Carried over the relay channel
   * from the control plane; fields are primitives so the protocol stays free
   * of the Elastic-zone policy type. `defaultBaseBranch: null` means "leave the
   * project's base branch unchanged" (the cloud's "repo default"). `*`-glob
   * patterns; empty list = allow any branch.
   */
  z.object({
    type: z.literal('set_branch_routing'),
    defaultBaseBranch: z.string().min(1).max(128).nullable(),
    allowedBranchPatterns: z.array(z.string().min(1).max(128)).max(50),
  }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/**
 * Project-scoped events fanned out to subscribers of `subscribe_project`.
 *
 * Kept intentionally small: today we only signal "something in the
 * conversation list changed, refetch." Per-row patch events can come
 * later if telemetry shows the refetch cost matters. The wire shape is
 * a discriminated union so future event types can be added without
 * breaking existing subscribers.
 */
export type ProjectEvent = { type: 'conversations_changed' } | { type: 'worktree_servers_changed' };

export const ProjectEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('conversations_changed') }).loose(),
  // The set of running on-demand worktree dev servers changed (one
  // started, exited, or was stopped) — the dock's worktree switcher
  // refetches `/__pinagent/worktree-servers`.
  z.object({ type: z.literal('worktree_servers_changed') }).loose(),
]);

// ---------- Server → client ----------

/**
 * Phase H lifecycle states the server can broadcast for a worktree.
 * Mirrors `Conversation.worktreeState` plus two transient states:
 *   - `landing` / `discarding` — operation is in flight (optimistic UI hint)
 *   - `conflict` — merge aborted because of conflicts; `conflicts` lists files
 *   - `ttl_warning` — orphan-sweeper found this worktree past TTL
 */
export const WorktreeWireStateSchema = z.enum([
  'none',
  'active',
  'landing',
  'landed',
  'discarding',
  'discarded',
  'conflict',
  'ttl_warning',
]);
export type WorktreeWireState = z.infer<typeof WorktreeWireStateSchema>;

export type ServerMessage =
  | { type: 'event'; feedbackId: string; event: AgentEvent }
  | { type: 'done'; feedbackId: string }
  | { type: 'error'; feedbackId?: string; message: string }
  | {
      type: 'worktree_state';
      feedbackId: string;
      state: WorktreeWireState;
      /** Merge commit sha when `state === 'landed'`. */
      commitSha?: string;
      /** Conflicted file paths when `state === 'conflict'`. */
      conflicts?: string[];
      /** Free-form message for non-conflict errors. */
      message?: string;
      /**
       * Count of files with uncommitted changes (`git status --porcelain`)
       * in the worktree. Only meaningful for active-ish states.
       */
      changesCount?: number;
    }
  /** Project-wide event; only delivered to sockets that sent `subscribe_project`. */
  | { type: 'project_event'; event: ProjectEvent }
  /**
   * Editor-bridge presence. Pushed to project subscribers whenever an
   * `extension_hello` socket connects or drops, and sent once on
   * `subscribe_project` / `query_extension` so a freshly-connected dock
   * gets the current state without waiting for a transition. `present`
   * reflects whether at least one extension socket is live; `version` is
   * the newest connected extension's reported version, if any.
   */
  | { type: 'extension_status'; present: boolean; version?: string }
  | { type: 'pong' };

/**
 * Runtime guard at the wire boundary. The dock's ws-client `safeParse`s
 * every incoming frame so drift in the server's wire format surfaces
 * as a dropped frame, not as `undefined` rendered into React.
 *
 * Kept separate from the manual `ServerMessage` type union above: the
 * type union narrows cleanly under discriminated-union semantics, and
 * the schema's `.loose()` index signatures would block that
 * narrowing for spread-and-mutate constructions on the agent-runner
 * side. Both must stay in sync — when adding a variant, update both.
 */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('event'),
      feedbackId: z.string(),
      event: AgentEventSchema,
    })
    .loose(),
  z
    .object({
      type: z.literal('done'),
      feedbackId: z.string(),
    })
    .loose(),
  z
    .object({
      type: z.literal('error'),
      feedbackId: z.string().optional(),
      message: z.string(),
    })
    .loose(),
  z
    .object({
      type: z.literal('worktree_state'),
      feedbackId: z.string(),
      state: WorktreeWireStateSchema,
      commitSha: z.string().optional(),
      conflicts: z.array(z.string()).optional(),
      message: z.string().optional(),
      changesCount: z.number().optional(),
    })
    .loose(),
  z
    .object({
      type: z.literal('project_event'),
      event: ProjectEventSchema,
    })
    .loose(),
  z
    .object({
      type: z.literal('extension_status'),
      present: z.boolean(),
      version: z.string().optional(),
    })
    .loose(),
  z
    .object({
      type: z.literal('pong'),
    })
    .loose(),
]);
