// SPDX-License-Identifier: Apache-2.0
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Render a single SDK message as a markdown fragment to append to the log.
 *
 * Returns '' for messages we don't surface (status pings, partial deltas,
 * etc.) so the caller can no-op cheaply.
 *
 * The aim is a readable transcript, not a raw event dump — text comes
 * through as plain markdown, tool calls collapse to a single-line chip,
 * errors stand out. If a new SDK message type arrives we don't recognise,
 * we drop it silently rather than serialising a JSON blob into the log.
 */
export function renderMessage(message: SDKMessage): string {
  switch (message.type) {
    case 'assistant':
      return renderAssistant(message);
    case 'result':
      // Result-specific footer rendering is handled by renderResultFooter().
      // We still emit a thin separator so the transcript has a visible end.
      return '\n---\n';
    case 'user':
      return renderUser(message);
    default:
      return '';
  }
}

export function renderInitFooter(
  message: Extract<SDKMessage, { type: 'system'; subtype: 'init' }>,
): string {
  const mcp = message.mcp_servers.map((s) => `${s.name}=${s.status}`).join(', ');
  const lines = [
    `> _session_ \`${message.session_id}\` · model \`${message.model}\` · ${message.permissionMode}`,
  ];
  if (mcp) lines.push(`> _mcp_ ${mcp}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function renderResultFooter(result: Extract<SDKMessage, { type: 'result' }>): string {
  const lines: string[] = [];
  if (result.subtype === 'success') {
    lines.push(
      `**Outcome:** success (${result.num_turns} turn${result.num_turns === 1 ? '' : 's'})`,
    );
  } else {
    lines.push(`**Outcome:** \`${result.subtype}\``);
    if (result.errors?.length) {
      lines.push('');
      for (const e of result.errors) lines.push(`> ${e}`);
    }
  }
  lines.push(
    `**Tokens:** in=${result.usage.input_tokens} · out=${result.usage.output_tokens}${
      result.usage.cache_read_input_tokens
        ? ` · cache_read=${result.usage.cache_read_input_tokens}`
        : ''
    }${
      result.usage.cache_creation_input_tokens
        ? ` · cache_write=${result.usage.cache_creation_input_tokens}`
        : ''
    }`,
  );
  lines.push(`**Cost:** $${result.total_cost_usd.toFixed(4)}`);
  lines.push(`**Duration:** ${(result.duration_ms / 1000).toFixed(1)}s`);
  return lines.join('  \n');
}

function renderAssistant(message: Extract<SDKMessage, { type: 'assistant' }>): string {
  const blocks = message.message.content;
  if (!Array.isArray(blocks)) return '';

  const out: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text.trim()) {
      out.push(`${block.text}\n`);
    } else if (block.type === 'tool_use') {
      out.push(renderToolUse(block.name, block.input));
    } else if (block.type === 'thinking') {
      // Skip thinking blocks from the log to keep transcripts focused on
      // observable actions. Add a tag so it's not invisible.
      out.push('<!-- thinking -->\n');
    }
  }
  if (message.error) {
    out.push(`\n> ⚠️  assistant error: \`${message.error}\`\n`);
  }
  if (out.length === 0) return '';
  return `${out.join('\n')}\n`;
}

function renderUser(message: Extract<SDKMessage, { type: 'user' }>): string {
  // The SDK emits `user` messages both for the initial prompt (which we
  // already log via the header) and for tool_result blocks fed back to the
  // model. Render tool results as collapsed chips so the reader can see what
  // a tool returned without 4000-line dumps.
  const content = message.message?.content;
  if (!Array.isArray(content)) return '';
  const chips: string[] = [];
  for (const block of content) {
    if (block.type === 'tool_result') {
      chips.push(renderToolResult(block));
    }
  }
  if (chips.length === 0) return '';
  return `${chips.join('\n')}\n`;
}

function renderToolUse(name: string, input: unknown): string {
  const summary = summariseToolInput(name, input);
  return `\`[${name}]\`${summary ? ` ${summary}` : ''}\n`;
}

function renderToolResult(block: { is_error?: boolean; content?: unknown }): string {
  const status = block.is_error ? '✗' : '✓';
  // We deliberately don't include block content — it's often a long file
  // read or a tool dump. The interesting payload is summarised in the
  // assistant's next text block.
  return `${status} _tool result_`;
}

export function summariseToolInput(name: string, input: unknown): string {
  if (input == null || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  // Use a small allow-list of fields that are useful at a glance — file
  // paths, commands, search patterns. Anything not here is left out to keep
  // chips short.
  const fileFields = ['file_path', 'path', 'filePath', 'notebook_path'];
  for (const f of fileFields) {
    if (typeof obj[f] === 'string') return `\`${obj[f]}\``;
  }
  if (typeof obj.command === 'string') return `\`${truncate(obj.command, 80)}\``;
  if (typeof obj.pattern === 'string') return `pattern=\`${truncate(obj.pattern, 60)}\``;
  if (typeof obj.url === 'string') return obj.url;
  if (typeof obj.prompt === 'string') return `\`${truncate(obj.prompt, 60)}\``;
  if (name.startsWith('mcp__')) {
    // For MCP tools, surface a single salient arg if available.
    const keys = Object.keys(obj);
    const first = keys[0];
    if (keys.length === 1 && first != null && typeof obj[first] !== 'object') {
      return `${first}=\`${String(obj[first])}\``;
    }
  }
  return '';
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
