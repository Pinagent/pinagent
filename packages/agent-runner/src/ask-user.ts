// SPDX-License-Identifier: Apache-2.0
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@pinagent/shared';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { clearAwaitingAsk, setAwaitingAsk } from './ask-state';
import { getOrCreateBus } from './bus';

/**
 * `ask_user` custom SDK tool — the agent's only blessed way to pause and
 * wait for a typed human answer mid-run.
 *
 * Flow:
 *   1. Model calls `ask_user({ question, ... })`.
 *   2. Handler generates an askId, publishes an `ask_user` AgentEvent to
 *      the feedback's bus (so subscribed WS clients render a form), and
 *      returns a Promise.
 *   3. User types an answer in the widget; the widget sends
 *      `ask_response { askId, answer }` over WS.
 *   4. The WS server calls `resolveAsk(askId, answer)`; the Promise
 *      resolves with a `CallToolResult` carrying the answer text; the
 *      agent receives it as the tool result and continues.
 *
 * If the run ends, the dev server restarts, or a TTL elapses with no
 * answer, the Promise rejects so the agent gets a clear failure rather
 * than hanging on a dead UI.
 */

const ASK_TTL_MS = 10 * 60 * 1000;

/** The prompt half of an `ask_user` event — everything but the correlation id. */
export type AskPrompt = Omit<Extract<AgentEvent, { type: 'ask_user' }>, 'type' | 'askId'>;

export interface AwaitAnswerOptions {
  /** How long the ask stays open once shown before it closes unanswered. */
  ttlMs: number;
  /** Closes the ask (queued or shown) as soon as it fires. */
  signal?: AbortSignal;
}

/**
 * Rejection reason when an ask closes without an answer. `message` is
 * the human-readable reason (also published on the `ask_expired` event).
 */
export class AskClosedError extends Error {
  override name = 'AskClosedError';
}

interface PendingAsk {
  feedbackId: string;
  event: Extract<AgentEvent, { type: 'ask_user' }>;
  ttlMs: number;
  /** True once the ask is published; queued asks aren't visible yet. */
  shown: boolean;
  timeout?: NodeJS.Timeout;
  /** Idempotent: tears down timer + listeners and settles the Promise. */
  settle: (outcome: { answer: string } | { closed: string }) => void;
}

/**
 * Pending asks LOCAL TO THIS CONTEXT, in arrival order. The settle
 * closures are tied to the waiting Promise — process-bound, not
 * serialisable. The WS server can land in a different context than the
 * one running the agent (Next 16 Turbopack, Vite 8), so we route
 * cross-context responses via `process.emit(ASK_RESPONSE_EVENT, ...)` —
 * see `resolveAsk`.
 *
 * At most one ask per feedback id is shown at a time: the widget renders
 * a single answer form, and the SDK can raise several asks at once
 * (parallel tool calls each hitting the permission gate). Later asks
 * queue behind the shown one and are published when it settles.
 */
const pending = new Map<string, PendingAsk>();

const ASK_RESPONSE_EVENT = 'pinagent:ask-response';

interface AskResponsePayload {
  askId: string;
  answer: string;
}

/**
 * Show `prompt` to the developer as an `ask_user` event on the
 * feedback's bus and wait for their `ask_response`. Resolves with the
 * answer text. Rejects with `AskClosedError` — after publishing an
 * `ask_expired` event so the UI retires the form — when `ttlMs` elapses,
 * `signal` aborts, or `rejectAsk` closes the run's asks.
 *
 * Shared by the model-facing `ask_user` tool and the runner's own
 * tool-permission gate (`permission-gate.ts`), so both reuse one
 * transport, one widget form and one cross-context answer route.
 */
export function awaitAnswer(
  feedbackId: string,
  prompt: AskPrompt,
  opts: AwaitAnswerOptions,
): Promise<string> {
  const askId = nanoid(10);
  return new Promise<string>((resolve, reject) => {
    const { signal } = opts;
    if (signal?.aborted) {
      reject(new AskClosedError('the run was stopped'));
      return;
    }

    // Listener for cross-context ask responses. `resolveAsk` in another
    // context emits this event when the WS server receives an
    // ask_response frame; we filter on askId so each pending promise
    // only fires for its own response.
    const onResponse = (payload: AskResponsePayload) => {
      if (payload.askId !== askId) return;
      const entry = pending.get(askId);
      if (entry?.shown) entry.settle({ answer: payload.answer });
    };
    const onAbort = () => pending.get(askId)?.settle({ closed: 'the run was stopped' });

    const entry: PendingAsk = {
      feedbackId,
      event: { type: 'ask_user', askId, ...prompt },
      ttlMs: opts.ttlMs,
      shown: false,
      settle: (outcome) => {
        if (!pending.has(askId)) return;
        clearTimeout(entry.timeout);
        pending.delete(askId);
        process.off(ASK_RESPONSE_EVENT, onResponse);
        signal?.removeEventListener('abort', onAbort);
        if ('answer' in outcome) {
          resolve(outcome.answer);
        } else {
          // Only a shown ask has a form to retire; a queued one was never
          // published, so there's nothing on the bus to close.
          if (entry.shown) {
            void getOrCreateBus(feedbackId).publish({
              type: 'ask_expired',
              askId,
              reason: outcome.closed,
            });
          }
          reject(new AskClosedError(outcome.closed));
        }
        // The run is no longer blocked on this ask (answered or closed).
        // Conditional on the id, so it can't clobber the next queued ask
        // that showNext publishes below.
        if (entry.shown) {
          const root = getOrCreateBus(feedbackId).projectRoot;
          if (root) void clearAwaitingAsk(root, feedbackId, askId);
        }
        showNext(feedbackId);
      },
    };

    pending.set(askId, entry);
    process.on(ASK_RESPONSE_EVENT, onResponse);
    signal?.addEventListener('abort', onAbort, { once: true });
    showNext(feedbackId);
  });
}

/** Publish the oldest pending ask for `feedbackId` unless one is already shown. */
function showNext(feedbackId: string): void {
  for (const entry of pending.values()) {
    if (entry.feedbackId !== feedbackId) continue;
    if (entry.shown) return;
    entry.shown = true;
    const seconds = Math.round(entry.ttlMs / 1000);
    entry.timeout = setTimeout(
      () => entry.settle({ closed: `no answer within ${seconds}s` }),
      entry.ttlMs,
    );
    // The TTL starts now, so stamp when it lapses — the widget counts down
    // to it so a waiting prompt can't quietly time out unnoticed.
    entry.event = { ...entry.event, expiresAt: new Date(Date.now() + entry.ttlMs).toISOString() };
    const bus = getOrCreateBus(feedbackId);
    const askId = entry.event.askId;
    // Publish first so the `ask_user` row (its timestamp + kind) exists by
    // the time list readers see `awaiting_ask_id` and look it up. Skip the
    // flag if the ask already settled while the publish was in flight.
    void bus.publish(entry.event).then(() => {
      if (bus.projectRoot && pending.get(askId)?.shown) {
        void setAwaitingAsk(bus.projectRoot, feedbackId, askId);
      }
    });
    return;
  }
}

const inputSchema = {
  question: z
    .string()
    .min(1)
    .max(2000)
    .describe('The question to ask the user. Be specific and concise.'),
  context: z
    .string()
    .max(2000)
    .optional()
    .describe(
      'Optional: what you are trying to do and why you need this clarification. Helps the user answer with the right context.',
    ),
  options: z
    .array(z.string().min(1).max(200))
    .max(6)
    .optional()
    .describe(
      'Optional: suggested answers. Rendered as one-click buttons. Use sparingly — only when the answer is genuinely closed-ended.',
    ),
};

/**
 * Build an SDK MCP server that exposes a single `ask_user` tool scoped to
 * one feedback id. The handler closes over `feedbackId` so the published
 * event lands on the correct bus.
 */
export function createAskUserMcpServer(feedbackId: string) {
  const askTool = tool(
    'ask_user',
    [
      'Ask the human developer a question and wait for their typed answer.',
      'Use this when you cannot proceed without clarification — preferred over',
      'guessing or making an assumption. The user sees the question in their',
      'browser widget and types a response.',
    ].join(' '),
    inputSchema,
    async (args) => {
      try {
        const answer = await awaitAnswer(
          feedbackId,
          { question: args.question, context: args.context, options: args.options },
          { ttlMs: ASK_TTL_MS },
        );
        return { content: [{ type: 'text', text: answer }] };
      } catch (err) {
        if (err instanceof AskClosedError) {
          throw new Error(`ask_user closed with no response: ${err.message}`);
        }
        throw err;
      }
    },
  );

  return createSdkMcpServer({
    name: 'pinagent-ask-user',
    version: '0.1.0',
    tools: [askTool],
  });
}

/**
 * Resolve the matching pending ask. Tries the local-context Map first
 * for the same-context case; otherwise broadcasts via `process.emit`
 * so the context running the agent (and holding the resolve closure)
 * can settle the Promise. Returns true optimistically when emitting
 * cross-context — we can't know synchronously whether another context
 * had a matching pending entry, but stale UI / double-submits are rare
 * enough that swallowing the "no pending ask" error is acceptable.
 */
export function resolveAsk(askId: string, answer: string): boolean {
  const entry = pending.get(askId);
  if (entry?.shown) {
    entry.settle({ answer });
    return true;
  }
  const payload: AskResponsePayload = { askId, answer };
  process.emit(ASK_RESPONSE_EVENT as Parameters<typeof process.emit>[0], payload as never);
  return true;
}

/**
 * Close every pending ask tied to this feedback id — shown and queued.
 * Called when the agent stream ends so the waiting Promise unblocks
 * rather than hanging until TTL.
 */
export function rejectAsk(feedbackId: string, reason: string): void {
  // Close queued asks before the shown one: settling the shown ask
  // publishes the next queued ask, which must already be gone.
  const entries = [...pending.values()].filter((e) => e.feedbackId === feedbackId);
  for (const entry of entries.reverse()) entry.settle({ closed: reason });
}

/**
 * MCP namespaces tools as `mcp__<server-name>__<tool-name>`. Pass this in
 * the SDK's `allowedTools` so the model can actually call it without a
 * permission prompt — otherwise `acceptEdits` mode wouldn't auto-allow a
 * non-Edit tool call.
 */
export const ASK_USER_TOOL_NAME = 'mcp__pinagent-ask-user__ask_user';
