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

const FeedbackId = z.string().min(8).max(16).regex(/^[A-Za-z0-9_-]+$/);

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
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------- Server → client ----------

export type ServerMessage =
  | { type: 'event'; feedbackId: string; event: AgentEvent }
  | { type: 'done'; feedbackId: string }
  | { type: 'error'; feedbackId?: string; message: string }
  | { type: 'pong' };
