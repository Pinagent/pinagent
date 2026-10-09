// SPDX-License-Identifier: Apache-2.0
import {
  type Options,
  type PermissionMode,
  query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@pinagent/shared';
import { buildSdkAuthEnv } from '../agent-auth';
import { findNearestAgentGuide, renderAgentGuide } from '../agent-guide';
import { resolveRunModel } from '../agent-model';
import {
  renderInitFooter,
  renderMessage,
  renderResultFooter,
  summariseToolInput,
} from '../agent-render';
import { ASK_USER_TOOL_NAME, createAskUserMcpServer } from '../ask-user';
import { createAutoModeFallback } from '../auto-mode-fallback';
import { createPermissionGate } from '../permission-gate';
import { resolveWorkspaceAdditionalDirectories } from '../workspace-root';
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
 * Appended-prompt lines that keep a headless run off the permission gate.
 *
 * - Exact tool names: with several pinagent-ish MCP servers registered
 *   (one per app in a monorepo), the agent picked `mcp__pinagent-app__*`,
 *   which nothing pre-approves, and ended without resolving.
 * - Shell shape: a command with `$(…)` / `${…}` or a `cd … &&` chain can't
 *   be statically checked, so it always needs a human answer and the run
 *   stalls on the widget prompt (up to its 5-minute timeout).
 */
const TOOL_GUIDANCE = [
  "Pinagent's own tools are pre-approved under these exact names:",
  `${PINAGENT_MCP_TOOLS.map((t) => `\`${t}\``).join(', ')}.`,
  'Use those, not tools from similarly named MCP servers (those are not pre-approved).',
  '',
  'Any other tool call that is not pre-approved may need approval: in auto mode a',
  'safety classifier decides it, and a call the classifier cannot approve (or, in',
  'the stricter modes, any such call) waits for the developer to approve it in the',
  'widget, and the run is stuck until they do. To keep it moving:',
  '- Find and read code with the Read, Grep and Glob tools, not shell pipelines.',
  '- When you need Bash, run one simple command with literal paths from the',
  '  current working directory: no command substitution (`$(…)`), shell variables',
  '  or `cd … &&` chains. Those can never be pre-approved by permission rules, so',
  '  each one risks blocking on the developer.',
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
      const run = query({ prompt: req.prompt, options: sdkOptions });
      // A requested `auto` the CLI can't honour comes back as `default`;
      // drop to `acceptEdits` with a log note instead. See auto-mode-fallback.ts.
      const autoFallback = createAutoModeFallback(req.permissionMode, run);
      for await (const message of run as AsyncIterable<SDKMessage>) {
        const sessionId =
          'session_id' in message && typeof message.session_id === 'string'
            ? message.session_id
            : undefined;
        const fallback = await autoFallback.check(message);

        if (message.type === 'system' && message.subtype === 'init') {
          apiKeySource = message.apiKeySource ?? null;
          const events = toAgentEvents(message);
          // The header chip shows the mode the run is actually in.
          for (const event of events) {
            if (fallback && event.type === 'init') event.permissionMode = fallback.mode;
          }
          yield {
            events,
            log: renderInitFooter(message) + (fallback?.note ?? ''),
            sessionId,
          };
          continue;
        }
        if (fallback) yield { events: [], log: fallback.note, sessionId };

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
  //
  // `buildSdkAuthEnv` strips the implicit `ANTHROPIC_API_KEY` from the
  // inherited env and re-adds a key only when the developer configured one
  // explicitly (the `apiKey` plugin option or the dock) — so an unconfigured
  // run authenticates against the Claude Code subscription instead of dying on
  // a stray shell key. See agent-auth.ts.
  const env = await buildSdkAuthEnv(req.projectRoot, {
    PINAGENT_PROJECT_ROOT: req.projectRoot,
    CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: '720000',
  });

  // Surface the guide nearest to the clicked element. The `claude_code`
  // preset already discovers guides by walking up from `cwd`, but that
  // misses a nested `CLAUDE.md` sitting beside the target file below the
  // worktree/project root — which is the one most relevant to this edit.
  // Prefer CLAUDE.md (this is the Claude provider) but accept AGENTS.md.
  const guide = findNearestAgentGuide(req.targetFile, req.projectRoot, { prefer: 'CLAUDE.md' });

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
        '',
        ...TOOL_GUIDANCE,
        ...(guide ? [renderAgentGuide(guide)] : []),
      ].join('\n'),
    },
  };

  // In a monorepo `cwd` is the app subdirectory; grant the enclosing repo
  // root so reads of sibling workspace packages don't stall the run on a
  // permission prompt. Empty for a worktree run
  // (its root is `cwd`). The permission gate below still applies.
  const additionalDirectories = await resolveWorkspaceAdditionalDirectories(req.cwd);
  if (additionalDirectories.length > 0) options.additionalDirectories = additionalDirectories;

  // Tool calls nothing pre-approved would otherwise be silently denied in
  // a headless run; ask the developer in the widget instead. In dry-run
  // the gate hard-denies every mutating / plan-exiting tool first. See
  // permission-gate.ts.
  const canUseTool = createPermissionGate({
    feedbackId: req.feedbackId,
    permissionMode: req.permissionMode,
  });
  if (canUseTool) options.canUseTool = canUseTool;

  // Pass `model` only when the developer chose one (env or project setting);
  // otherwise the SDK's bundled CLI default applies. Resolved per turn, so a
  // follow-up picks up a changed setting.
  const model = await resolveRunModel(req.projectRoot);
  if (model) options.model = model;

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
