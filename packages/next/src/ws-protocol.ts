import { z } from 'zod';
import type { AgentEvent } from './event-bus';

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
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------- Server → client ----------

/**
 * Phase H lifecycle states the server can broadcast for a worktree.
 * Mirrors `Conversation.worktreeState` plus two transient states:
 *   - `landing` / `discarding` — operation is in flight (optimistic UI hint)
 *   - `conflict` — merge aborted because of conflicts; `conflicts` lists files
 *   - `ttl_warning` — orphan-sweeper found this worktree past TTL
 */
export type WorktreeWireState =
  | 'none'
  | 'active'
  | 'landing'
  | 'landed'
  | 'discarding'
  | 'discarded'
  | 'conflict'
  | 'ttl_warning';

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
    }
  | { type: 'pong' };
