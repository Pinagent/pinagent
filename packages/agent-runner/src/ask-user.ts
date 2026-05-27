// SPDX-License-Identifier: Apache-2.0
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { nanoid } from 'nanoid';
import { z } from 'zod';
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

interface PendingAsk {
  feedbackId: string;
  resolve: (answer: string) => void;
  reject: (reason: string) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Pending asks LOCAL TO THIS CONTEXT. The resolve/reject closures are
 * tied to the agent's Promise — process-bound, not serialisable. The
 * WS server can land in a different context than the one running the
 * agent (Next 16 Turbopack, Vite 8), so we route cross-context responses
 * via `process.emit(ASK_RESPONSE_EVENT, ...)` — see `resolveAsk`.
 */
const pending = new Map<string, PendingAsk>();

const ASK_RESPONSE_EVENT = 'pinagent:ask-response';

interface AskResponsePayload {
  askId: string;
  answer: string;
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
      const askId = nanoid(10);
      const bus = getOrCreateBus(feedbackId);

      const answer = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(askId);
          process.off(ASK_RESPONSE_EVENT, onResponse);
          reject(new Error(`ask_user timed out after ${ASK_TTL_MS / 1000}s with no response`));
        }, ASK_TTL_MS);

        // Listener for cross-context ask responses. `resolveAsk` in
        // another context emits this event when the WS server receives
        // an ask_response frame; we filter on askId so each pending
        // promise only fires for its own response.
        const onResponse = (payload: AskResponsePayload) => {
          if (payload.askId !== askId) return;
          const entry = pending.get(askId);
          if (entry) entry.resolve(payload.answer);
        };
        process.on(ASK_RESPONSE_EVENT, onResponse);

        pending.set(askId, {
          feedbackId,
          resolve: (a: string) => {
            clearTimeout(timeout);
            pending.delete(askId);
            process.off(ASK_RESPONSE_EVENT, onResponse);
            resolve(a);
          },
          reject: (reason: string) => {
            clearTimeout(timeout);
            pending.delete(askId);
            process.off(ASK_RESPONSE_EVENT, onResponse);
            reject(new Error(reason));
          },
          timeout,
        });

        void bus.publish({
          type: 'ask_user',
          askId,
          question: args.question,
          context: args.context,
          options: args.options,
        });
      });

      return {
        content: [{ type: 'text', text: answer }],
      };
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
  if (entry) {
    entry.resolve(answer);
    return true;
  }
  const payload: AskResponsePayload = { askId, answer };
  process.emit(ASK_RESPONSE_EVENT as Parameters<typeof process.emit>[0], payload as never);
  return true;
}

/**
 * Reject every pending ask tied to this feedback id. Called when the
 * agent stream ends so the SDK Promise unblocks rather than hanging
 * until TTL.
 */
export function rejectAsk(feedbackId: string, reason: string): void {
  for (const [askId, entry] of pending.entries()) {
    if (entry.feedbackId === feedbackId) {
      entry.reject(reason);
      pending.delete(askId);
    }
  }
}

/**
 * MCP namespaces tools as `mcp__<server-name>__<tool-name>`. Pass this in
 * the SDK's `allowedTools` so the model can actually call it without a
 * permission prompt — otherwise `acceptEdits` mode wouldn't auto-allow a
 * non-Edit tool call.
 */
export const ASK_USER_TOOL_NAME = 'mcp__pinagent-ask-user__ask_user';
