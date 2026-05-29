// SPDX-License-Identifier: Apache-2.0
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import {
  renderInitFooter,
  renderMessage,
  renderResultFooter,
  summariseToolInput,
} from '../src/agent-render';

/**
 * The renderer functions work on subsets of SDKMessage. The full
 * SDKMessage type has dozens of fields we don't read — we cast our
 * test fixtures so we don't have to fill every field.
 */
function asSdk<T extends SDKMessage>(m: Partial<T>): SDKMessage {
  return m as SDKMessage;
}

describe('renderMessage', () => {
  it('returns empty string for unknown message types', () => {
    expect(renderMessage(asSdk({ type: 'status' as never }))).toBe('');
  });

  it('renders assistant text blocks as plain markdown', () => {
    const out = renderMessage(
      asSdk({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello world' }],
        } as never,
      }),
    );
    expect(out).toContain('Hello world');
  });

  it('renders assistant tool_use as a labelled chip with file path', () => {
    const out = renderMessage(
      asSdk({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/foo.ts' } }],
        } as never,
      }),
    );
    expect(out).toContain('`[Edit]`');
    expect(out).toContain('`src/foo.ts`');
  });

  it('renders the thinking-tag comment for thinking blocks (not the content)', () => {
    const out = renderMessage(
      asSdk({
        type: 'assistant',
        message: {
          content: [{ type: 'thinking', thinking: 'secret reasoning' }],
        } as never,
      }),
    );
    expect(out).toContain('<!-- thinking -->');
    expect(out).not.toContain('secret reasoning');
  });

  it('appends an assistant-error line when message.error is set', () => {
    const out = renderMessage(
      asSdk({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'partial' }] } as never,
        error: 'rate_limit',
      }),
    );
    expect(out).toContain('rate_limit');
    expect(out).toContain('assistant error');
  });

  it('returns "" for an assistant message with no renderable blocks', () => {
    const out = renderMessage(
      asSdk({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '   ' }] } as never,
      }),
    );
    expect(out).toBe('');
  });

  it('renders user tool_result blocks as collapsed status chips', () => {
    const ok = renderMessage(
      asSdk({
        type: 'user',
        message: { content: [{ type: 'tool_result', is_error: false }] } as never,
      }),
    );
    const err = renderMessage(
      asSdk({
        type: 'user',
        message: { content: [{ type: 'tool_result', is_error: true }] } as never,
      }),
    );
    expect(ok).toContain('✓');
    expect(err).toContain('✗');
    // No 4000-line dumps — content is suppressed.
    expect(ok).not.toContain('large file content');
  });

  it('renders the result message as a separator only (footer is built separately)', () => {
    const out = renderMessage(asSdk({ type: 'result' }));
    expect(out).toBe('\n---\n');
  });
});

describe('renderInitFooter', () => {
  it('includes session id, model, permission mode, and MCP server list', () => {
    const out = renderInitFooter({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-abc',
      model: 'claude-opus-4-7',
      permissionMode: 'acceptEdits',
      mcp_servers: [{ name: 'pinagent', status: 'connected' }],
    } as never);
    expect(out).toContain('sess-abc');
    expect(out).toContain('claude-opus-4-7');
    expect(out).toContain('acceptEdits');
    expect(out).toContain('pinagent=connected');
  });

  it('omits the mcp line when no servers are connected', () => {
    const out = renderInitFooter({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      model: 'claude',
      permissionMode: 'default',
      mcp_servers: [],
    } as never);
    expect(out).not.toContain('_mcp_');
  });
});

describe('renderResultFooter', () => {
  it('renders success outcome with turn count, tokens, cost, duration', () => {
    const out = renderResultFooter({
      type: 'result',
      subtype: 'success',
      num_turns: 3,
      usage: { input_tokens: 1000, output_tokens: 200 },
      total_cost_usd: 0.0123,
      duration_ms: 5400,
    } as never);
    expect(out).toContain('success');
    expect(out).toContain('3 turns');
    expect(out).toContain('in=1000');
    expect(out).toContain('out=200');
    expect(out).toContain('$0.0123');
    expect(out).toContain('5.4s');
  });

  it('singularises "1 turn"', () => {
    const out = renderResultFooter({
      type: 'result',
      subtype: 'success',
      num_turns: 1,
      usage: { input_tokens: 0, output_tokens: 0 },
      total_cost_usd: 0,
      duration_ms: 0,
    } as never);
    expect(out).toContain('1 turn)');
  });

  it('renders an error outcome with subtype + error lines', () => {
    const out = renderResultFooter({
      type: 'result',
      subtype: 'error_during_execution',
      num_turns: 2,
      usage: { input_tokens: 50, output_tokens: 50 },
      total_cost_usd: 0.001,
      duration_ms: 2000,
      errors: ['network blip', 'retry exhausted'],
    } as never);
    expect(out).toContain('`error_during_execution`');
    expect(out).toContain('network blip');
    expect(out).toContain('retry exhausted');
  });

  it('relabels notional cost as API-equivalent for an OAuth run', () => {
    const out = renderResultFooter(
      {
        type: 'result',
        subtype: 'success',
        num_turns: 1,
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.0123,
        duration_ms: 1000,
      } as never,
      'oauth',
    );
    expect(out).toContain('≈$0.0123');
    expect(out).toContain('API-equivalent');
    expect(out).toContain('subscription');
    // Never the bare "Cost: $0.0123" that reads as a real charge.
    expect(out).not.toContain('**Cost:** $0.0123');
  });

  it('shows a plain dollar cost for a non-oauth source', () => {
    const out = renderResultFooter(
      {
        type: 'result',
        subtype: 'success',
        num_turns: 1,
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.0123,
        duration_ms: 1000,
      } as never,
      'user',
    );
    expect(out).toContain('**Cost:** $0.0123');
    expect(out).not.toContain('API-equivalent');
  });

  it('appends cache token counts when present', () => {
    const out = renderResultFooter({
      type: 'result',
      subtype: 'success',
      num_turns: 1,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 200,
      },
      total_cost_usd: 0.01,
      duration_ms: 1000,
    } as never);
    expect(out).toContain('cache_read=800');
    expect(out).toContain('cache_write=200');
  });
});

describe('summariseToolInput', () => {
  it('returns file_path as a backticked string', () => {
    expect(summariseToolInput('Edit', { file_path: 'src/x.ts' })).toBe('`src/x.ts`');
  });

  it('checks path, filePath, notebook_path in order', () => {
    expect(summariseToolInput('Read', { path: '/abs/path' })).toBe('`/abs/path`');
    expect(summariseToolInput('Write', { filePath: 'rel/path' })).toBe('`rel/path`');
    expect(summariseToolInput('NotebookEdit', { notebook_path: 'nb.ipynb' })).toBe('`nb.ipynb`');
  });

  it('renders bash commands, truncated', () => {
    const longCmd = 'echo '.repeat(20);
    const out = summariseToolInput('Bash', { command: longCmd });
    expect(out).toMatch(/^`echo /);
    expect(out.length).toBeLessThanOrEqual(82); // 80-char truncation + backticks
  });

  it('renders search patterns with pattern= prefix', () => {
    expect(summariseToolInput('Grep', { pattern: 'foo' })).toBe('pattern=`foo`');
  });

  it('renders urls plain', () => {
    expect(summariseToolInput('WebFetch', { url: 'https://example.com' })).toBe(
      'https://example.com',
    );
  });

  it('renders a single MCP arg when shape is unambiguous', () => {
    expect(summariseToolInput('mcp__pinagent__resolve_feedback', { id: 'abc' })).toBe('id=`abc`');
  });

  it('returns "" for null / non-object input', () => {
    expect(summariseToolInput('Bash', null)).toBe('');
    expect(summariseToolInput('Bash', 42)).toBe('');
    expect(summariseToolInput('Bash', 'string')).toBe('');
    expect(summariseToolInput('Bash', undefined)).toBe('');
  });

  it('returns "" for an unknown shape', () => {
    expect(summariseToolInput('Edit', { random: 'thing' })).toBe('');
  });
});
