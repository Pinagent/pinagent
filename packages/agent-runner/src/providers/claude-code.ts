// SPDX-License-Identifier: Apache-2.0
import {
  type Options,
  type PermissionMode,
  query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@pinagent/shared';
import {
  renderInitFooter,
  renderMessage,
  renderResultFooter,
  summariseToolInput,
} from '../agent-render';
import { ASK_USER_TOOL_NAME, createAskUserMcpServer } from '../ask-user';
import { SecretsStore } from '../secrets-store';
import type { AgentProvider, AgentRunRequest, ProviderRunItem } from './types';

/**
 * @pinagent/mcp tool names the spawned agent needs to do its job:
 *
 * - `get_feedback`         — fetch the full feedback record incl. screenshot
 * - `resolve_feedback`     — mark fixed/wontfix/deferred when done
 * - `get_source_context`   — read a window of source around file:line
 * - `list_pending_feedback`— rarely needed by a spawned agent (it knows its
 *                            own id), included for parity with pull mode
 *
 * They are surfaced to the SDK via the user's `.mcp.json` (loaded by
 * `settingSources: ['user', 'project', 'local']`). Allowlisting them
 * makes the spawned agent auto-accept the calls instead of timing out
 * waiting for a non-existent permission prompt.
 */
const PINAGENT_MCP_TOOLS = [
  'mcp__pinagent__get_feedback',
  'mcp__pinagent__resolve_feedback',
  'mcp__pinagent__get_source_context',
  'mcp__pinagent__list_pending_feedback',
];

/**
 * The default, most capable provider: the Claude Agent SDK. Runs the full
 * agentic loop (tool calls, edits, permission gating, session resume) and
 * streams its `SDKMessage`s, which we normalize into Pinagent's
 * `AgentEvent` union here so nothing downstream has to know it was Claude.
 */
export class ClaudeCodeProvider implements AgentProvider {
  readonly id = 'claude-code';

  async *run(req: AgentRunRequest): AsyncIterable<ProviderRunItem> {
    const sdkOptions = await buildSdkOptions(req);
    const startedAt = Date.now();

    // Captured from the run's `system/init` message so the result footer can
    // relabel notional (subscription) cost. Stays null until init arrives,
    // which always precedes the result.
    let apiKeySource: string | null = null;
    // One assistant message = one model turn. We surface a running count so
    // the widget footer ticks up live, ahead of the authoritative `numTurns`
    // on the terminal `result`.
    let turn = 0;
    // Whether the SDK delivered its own terminal `result`. If it did, a later
    // throw is post-completion noise we drop; if it didn't (abort, transport
    // failure, internal crash), we synthesize one in the catch below.
    let sawResult = false;

    try {
      for await (const message of query({
        prompt: req.prompt,
        options: sdkOptions,
      }) as AsyncIterable<SDKMessage>) {
        const sessionId =
          'session_id' in message && typeof message.session_id === 'string'
            ? message.session_id
            : undefined;

        if (message.type === 'system' && message.subtype === 'init') {
          apiKeySource = message.apiKeySource ?? null;
          yield {
            events: toAgentEvents(message),
            log: renderInitFooter(message),
            sessionId,
          };
          continue;
        }

        if (message.type === 'result') {
          sawResult = true;
          yield {
            events: toAgentEvents(message),
            log: renderMessage(message),
            sessionId,
            isResult: true,
            resultFooter: renderResultFooter(message, apiKeySource),
          };
          continue;
        }

        const events = toAgentEvents(message);
        if (message.type === 'assistant') {
          turn += 1;
          events.push({ type: 'progress', turn });
        }
        yield { events, log: renderMessage(message), sessionId };
      }
    } catch (err) {
      // The SDK stream threw: the user aborted (clicked Stop), or auth /
      // transport / internal SDK failure. If the terminal `result` already
      // went out this is post-completion noise — drop it. Otherwise synthesize
      // a terminal `result` so the widget always leaves the running state with
      // a meaningful subtype, mirroring the CLI provider rather than surfacing
      // a raw AbortError through the orchestrator's generic catch.
      if (sawResult) return;
      const aborted = req.abortSignal.aborted;
      const detail = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - startedAt;
      const resultEvent: AgentEvent = {
        type: 'result',
        subtype: aborted ? 'aborted' : 'error',
        numTurns: turn,
        // No authoritative cost on a stream that never reached its `result`.
        totalCostUsd: 0,
        durationMs,
      };
      const events: AgentEvent[] = [];
      const seconds = `${(durationMs / 1000).toFixed(1)}s`;
      let footer: string;
      if (aborted) {
        footer = `**Outcome:** \`aborted\`  \n**Duration:** ${seconds}`;
      } else {
        resultEvent.errors = [detail];
        // Keep the human-readable message on the bus too (the widget renders
        // `error` events inline); the `result` carries the terminal subtype.
        events.push({ type: 'error', message: detail });
        footer = `**Outcome:** \`error\`  \n> ${detail}  \n**Duration:** ${seconds}`;
      }
      events.push(resultEvent);
      yield {
        events,
        log: `\n> [pinagent] ${aborted ? 'run aborted by user' : `agent stream errored: ${detail}`}\n`,
        isResult: true,
        resultFooter: footer,
      };
    }
  }
}

/**
 * Build the Claude Agent SDK options for a run. Kept byte-for-byte
 * equivalent to the original inline construction in `agent.ts` so the
 * SDK-mocking tests (which assert on the params handed to `query()`)
 * continue to pass unchanged.
 */
async function buildSdkOptions(req: AgentRunRequest): Promise<Options> {
  // The `ask_user` tool can block for up to 10 min waiting for a human
  // response. SDK MCP tool calls time out at 60s by default; bump it to
  // ~12 min to cover the full ASK_TTL window in ask-user.ts.
  const env: Record<string, string | undefined> = {
    ...process.env,
    PINAGENT_PROJECT_ROOT: req.projectRoot,
    CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: '720000',
  };

  // Dock-stored Anthropic key (set via Connections route) wins over an
  // existing env var so the user can override CI-style auth without
  // restarting the dev-server. No-op when the user hasn't set one.
  const storedKey = await new SecretsStore(req.projectRoot).getAnthropicKey();
  if (storedKey) env.ANTHROPIC_API_KEY = storedKey;

  const options: Options = {
    cwd: req.cwd,
    permissionMode: req.permissionMode as PermissionMode,
    env,
    settingSources: ['user', 'project', 'local'],
    abortController: toAbortController(req.abortSignal),
    mcpServers: {
      'pinagent-ask-user': createAskUserMcpServer(req.feedbackId),
    },
    allowedTools: [ASK_USER_TOOL_NAME, ...PINAGENT_MCP_TOOLS],
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: [
        '',
        'You are running inside Pinagent, a tool that lets developers click a UI',
        'element in the browser and leave a comment for you to act on. The user',
        'is watching your output stream into a small widget pane next to the',
        'element they clicked.',
        '',
        `If you need clarification mid-task, call the \`${ASK_USER_TOOL_NAME}\``,
        'tool with a clear question (and optional `options` for closed-ended',
        'answers). Prefer asking over guessing on ambiguous requirements.',
      ].join('\n'),
    },
  };
  if (req.resume) options.resume = req.resume;
  return options;
}

/**
 * The SDK wants an `AbortController`, but the provider contract hands us a
 * bare `AbortSignal` (so non-SDK providers aren't forced to fabricate a
 * controller). Bridge the two by forwarding the signal's abort to a fresh
 * controller the SDK can own.
 */
function toAbortController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', () => controller.abort(), { once: true });
  return controller;
}

/** Translate one SDK message into zero or more Pinagent bus events. */
function toAgentEvents(message: SDKMessage): AgentEvent[] {
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init') {
        return [
          {
            type: 'init',
            sessionId: message.session_id,
            model: message.model,
            permissionMode: message.permissionMode,
            apiKeySource: message.apiKeySource,
          },
        ];
      }
      return [];
    case 'assistant': {
      const out: AgentEvent[] = [];
      const blocks = message.message?.content;
      if (!Array.isArray(blocks)) return out;
      for (const block of blocks) {
        if (block.type === 'text' && block.text.trim()) {
          out.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          // ask_user calls are surfaced by the tool handler itself (it
          // publishes an 'ask_user' event with the question). Suppress
          // the bare tool_use chip so the widget doesn't render a
          // duplicate "[ask_user]" line alongside the form.
          if (block.name === ASK_USER_TOOL_NAME) continue;
          out.push({
            type: 'tool_use',
            name: block.name,
            summary: summariseToolInput(block.name, block.input),
          });
        }
      }
      if (message.error) {
        out.push({ type: 'error', message: `assistant error: ${message.error}` });
      }
      return out;
    }
    case 'user': {
      const out: AgentEvent[] = [];
      const blocks = message.message?.content;
      if (!Array.isArray(blocks)) return out;
      for (const block of blocks) {
        if (
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: string }).type === 'tool_result'
        ) {
          out.push({ type: 'tool_result', ok: !(block as { is_error?: boolean }).is_error });
        }
      }
      return out;
    }
    case 'result': {
      const event: AgentEvent = {
        type: 'result',
        subtype: message.subtype,
        numTurns: message.num_turns,
        totalCostUsd: message.total_cost_usd,
        durationMs: message.duration_ms,
      };
      if (message.subtype !== 'success' && Array.isArray(message.errors)) {
        event.errors = message.errors;
      }
      return [event];
    }
    default:
      return [];
  }
}
