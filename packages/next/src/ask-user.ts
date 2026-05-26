import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getOrCreateBus } from './event-bus';

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

// Singleton across module re-evaluations — same reason as the event
// bus. Without this, an ask published by an agent (running in one
// route-module instance) would never resolve when the WS handler
// (singleton on globalThis, bound to an earlier instance) tries to
// look up the askId. See event-bus.ts for the longer note.
const ASKS_SYMBOL = Symbol.for('pinagent.ask-user.pending');
const pending: Map<string, PendingAsk> =
  ((globalThis as Record<symbol, unknown>)[ASKS_SYMBOL] as Map<string, PendingAsk> | undefined) ??
  new Map<string, PendingAsk>();
(globalThis as Record<symbol, unknown>)[ASKS_SYMBOL] = pending;

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
          reject(new Error(`ask_user timed out after ${ASK_TTL_MS / 1000}s with no response`));
        }, ASK_TTL_MS);

        pending.set(askId, {
          feedbackId,
          resolve: (a: string) => {
            clearTimeout(timeout);
            pending.delete(askId);
            resolve(a);
          },
          reject: (reason: string) => {
            clearTimeout(timeout);
            pending.delete(askId);
            reject(new Error(reason));
          },
          timeout,
        });

        bus.publish({
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
 * Resolve the matching pending ask. Returns false if no such ask is
 * pending (stale UI, double-submit, etc.).
 */
export function resolveAsk(askId: string, answer: string): boolean {
  const entry = pending.get(askId);
  if (!entry) return false;
  entry.resolve(answer);
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
